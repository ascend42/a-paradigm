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
 *   (spawn argv redacted, exit, drain interrupt) to `<home>/trace/<project key>/` (TD-2026-10-19-057: never the project); the session.sandbox row says
 *   `traced: true` (or `traced: false, traceRefused`). The tee never blocks the session (bounded queue, counted drops).
 * Model switch (8.0:model-switch; probe p-set-model, claude 2.1.304): switchModel() serves the HUMAN's
 *   request.session.model{hsid, model} (the dispatcher routes it from a first-party gui/device connection only;
 *   any other class is refused FORBIDDEN here too). Refused before any row: a local session (local-session), a
 *   running turn (turn-running), a switch in flight (model-switching), and ANY session above
 *   MODEL_SWITCH_CONTEXT_GUARD.maxTokens moving to a 200k model (a target without `[1m]`, whatever the source:
 *   context-too-large; the context is the LAST main-chain assistant message's in+cacheRead+cacheWrite+out, never
 *   result totals or a subagent's message). A resumed session's context is unknown until its first main-chain
 *   message: a 200k target is refused context-too-large ("send one message first") meanwhile (Aegis M2).
 *   Then: the request row → law 7 re-run → a NEW session.spawn permit for the new model (assertClaudePermit,
 *   subscription billing only; a refusal is session.model{permit-refused}) → session.inject{channel:'model'} →
 *   control_request{set_model} → wait for its control_response by request id (modelSwitchTimeoutMs, default
 *   MODEL_SWITCH_TIMEOUT_MS). success ⇒ the new permit replaces the spawn permit (the old one is released) and
 *   the model is on record; error ⇒ the new permit is released, nothing changed (MODEL_UNAVAILABLE{model-switch-
 *   failed}); timeout ⇒ the new permit is HELD (Aegis M1: claude may already run the new model), the old model
 *   stays on record and the session is marked modelUncertain (status) until the next main-chain assistant
 *   message's `message.model` (ground truth) RECONCILES it: session.model{outcome:'reconciled'}. Reconciled to the
 *   new model ⇒ the held permit replaces the spawn permit exactly as on success (the row cites it); to the old ⇒
 *   the held permit is released; the session exiting (or a later switch) meanwhile ⇒ released. session.send is
 *   refused model-switching while a switch is in flight. A failed permit release goes to the injected logger.
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
import { claudeModelProblem, hsidShort, mintHsid, MODEL_SWITCH_CONTEXT_GUARD, MODEL_SWITCH_REASON_ROUTES, refuse, RefusedError, turnId, validateKindPayload, type RefusalCode, type DrainExitReason, type ResumeRefusal, type SessionModelOutcome } from '@a-company/gnomon-contracts';
import type { DaemonChildren } from '../lifecycle/children.js';
import type { BudgetFuse, PermitV1 } from '../budget/fuse.js';
import type { ApprovalBroker } from '../broker/broker.js';
import { ALWAYS_ASK_TOOLS, SESSION_CACHE_ENV, WRITE_TEMP_PATHS, buildSessionPolicy, CLAUDE_SESSION_ENV_REL, CLAUDE_TRANSCRIPTS_REL, SESSION_UUID_RE, claudePermissions, policyHash, realpathLoose, type PolicyPath, type SessionPolicy } from '../manifest/policy.js';
import { releaseSession, releaseSessionGrants, sessionSidFor } from '../../platform/win32/session-sandbox.js';
import { privateToUser } from '../../platform/owner-only.js';
import { layersHash, gitHash, defaultClaudeJson } from '../manifest/layers.js';
import { verifiedGenerated } from '../manifest/generate.js';
import { ManifestRefusal } from '../manifest/refusal.js';
import { sessionLaunchPlan, sessionSandboxFidelity } from '../sandbox/session.js';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import { buildSessionEnv, win32SessionTempDir, DARWIN_SCREEN_TMP_FALLBACK, missingIdentity, planSessionPath, sessionIdentity, sessionNodeDir, sessionPathFor, type SessionIdentity } from '../runner/env.js';
import { claudeAuthOk, claudeJsonProjection, claudeVersion, law7Layers, law7Scan, managedFiles, PreflightRefusal, realLoose, resolveClaudeBinary, type ClaudeRun, type Law7Input, type SessionRefusalCode } from '../runner/preflight.js';
import { commitPin, prepareClaude, readClaudePin } from '../runner/binary.js';
import { buildClaudeArgv, hookFactsOf, hookStoredLine, syntheticStoredLine, DEFAULT_SESSION_HOOKS, repoContextFor, settingSourcesFor, type SessionHooksMode, controlErrorLine, controlInterruptLine, mcpResponseLine, controlSetModelLine, LineSplitter, parseStreamLine, permissionAllowLine, permissionDenyLine, UsageMeter, userMessageLine, type AdapterEvent } from '../../adapters/claude-code/adapter.js';
import { EDIT_RULE_TOOLS as EDIT_SCOPE_TOOLS } from './rules.js';
import { answerFor, ASK_USER_TIMEOUT_MS, composePermission, EDIT_SCOPE_KINDS, inputHash, withEditScopes, MAX_ATTACHED_PLAN_CHARS, MAX_PENDING_PERMISSIONS, parseAskAnswer, PLAN_FILE, type AskQuestion, type CardKindP } from './permission.js';
import { claudeCodePlatform, type ClaudeCodePlatformRow } from '../../platform/claude-code.js';
import type { DarwinSessionExtras } from '../../platform/darwin/session-sbpl.js';
import { LocalLane, type LocalLaneOptions, type LoopOpenRequest, type LoopSessionHandle } from './local-session.js';
import type { LocalProbeSink } from '../local/config-request.js';
import { extractRepoHooks, hooksBlock, mergeHooks, MAX_PENDING_HOOK_CARDS, MAX_REFUSED_LOGGED, repoHookCard, repoKeyOf, type RepoHook } from './repo-hooks.js';
import { buildRepoContext, memoryChainOf, REPO_CONTEXT_ENV, REPO_CONTEXT_SETTINGS, repoContextLines, repoContextRow, repoSettingsInfo, repoSettingsLines, type RepoContext } from './repo-context.js';
import type { LocalLaneConfig } from '../local/config.js';
import { openTraceStream, redactArgv, redactText, TRACE_DRAIN_FLUSH_MS, TraceRefused, type TraceOpenOptions, type TraceStream } from '../trace/capture.js';
import { traceModeOf } from '../trace/mode.js';
import { autoBashReadOnly, autoEditPass, READ_ONLY_ASK_MODE_REF, READ_ONLY_MODE_REF } from './auto-edits.js';
import { manualHolds } from '../broker/run-mode.js';
import { voiceTag, type VoiceAttribution, type VoiceTurnLink } from '../voice/voice-control.js';
import type { RunMode, VoiceSentBy } from '@a-company/gnomon-contracts';
import { pieceGuidance, VoicePieceCounter } from './voice-origin.js';
import type { LoopRunRef } from '../loops/registry.js';
import { loopClampAllows, withLoopOrigin } from './loop-clamp.js';
import { guidanceHashOf } from '../voice/table-talk.js';
import type { GitVerbs, VerbSession } from '../git/kernel-verbs.js';
import { GIT_VERB_TOOLS, GIT_VERBS_GUIDANCE, KERNEL_MCP_SERVER, kernelToolName, kernelWorktreeDirs } from '../git/verbs.js';
import { KERNEL_MCP_ENTRY, kernelMcpAnswer } from './kernel-mcp.js';

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
 * After a drained child is stopped, how long the drain waits for that session's exit path (session-env emptied,
 * permits released, history written; `#onExit` runs off the child's `close`, queued behind its stdout lines) before
 * it reports the session. Bounded so a child whose pipes never close cannot hold the upgrade.
 */
export const DRAIN_EXIT_SETTLE_MS = 2_000;
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

/** How long a model switch waits for claude's set_model control_response before it records `timeout` (8.0:model-switch). */
export const MODEL_SWITCH_TIMEOUT_MS = 15_000;

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
  /** the env the child's allowlist is read from (default process.env); never the source of USER/LOGNAME/SHELL/TMPDIR on POSIX */
  env?: () => Readonly<Record<string, string | undefined>>;
  /** the OS identity the child's USER/LOGNAME/SHELL/TMPDIR come from (default sessionIdentity(), resolved once in the constructor) */
  identity?: () => SessionIdentity | null;
  /** TD-2026-10-21-077: the root-signed `config.sessions.path` (null/absent ⇒ runner/env.ts defaultSessionPath); never the daemon's PATH */
  sessionPath?: readonly string[] | null;
  /** test seam: the node whose dir heads the default session PATH (default process.execPath) */
  nodeExecPath?: string;
  endpointPort?: () => number | null;
  linkedFolders?: () => string[];
  platform?: string;
  /** whose hooks run (T-2026-10-18-010 L4, P8-D94): the root-signed `config.sessions.hooks` mode; default `audited` */
  hooksMode?: SessionHooksMode;
  /**
   * #mcp-passthrough (TD-2026-10-20-812): the session's mcp servers = the repo's VERIFIED GENERATED distro servers
   * (`.gnomon/generated/.mcp.json`, kernel output checked against the kernel-held record; passed through, never
   * subject to the reserved-prefix drop) + installed, granted mods' provides.mcp as gm_<pub>_<name>. Absent ⇒ the
   * distro servers only.
   */
  deskMcp?: (distroServers: Record<string, unknown>, ctx: { hsid: string; cwd: string; worktree?: string }) => Record<string, unknown>;
  /**
   * #mcp-servers (T-2026-10-23-003): extra write-denies for every session profile: the first-party Paradigm MCP's
   * package dir and the node that runs it, so no session can swap what the next session's server runs.
   */
  mcpDenyWrite?: (ctx: { cwd: string; worktree?: string }) => readonly PolicyPath[];
  /** P8-D94: the human's per-hook decisions for (repoKey, setHash), read back from KERNEL-signed gate-class.decided rows; absent ⇒ none (no repo hook runs) */
  repoHookDecisions?: (repoKey: string, setHash: string) => ReadonlyMap<string, 'allow' | 'deny'>;
  /** S-L1: the standing `always` rule an exact (repoKey, tool, inputHash) matches, DERIVED from kernel-signed rows only (rules.ts RuleBook); absent ⇒ none */
  alwaysRule?: (repoKey: string, tool: string, inputHash: string, toolInput?: unknown, ctx?: { prefixRules: boolean; roots: readonly string[]; editPath?: string | null; repoEdits?: boolean }) => { ruleId: string } | null;
  /**
   * P8-D87 run modes (broker/run-mode.ts RunModeControl.view): the session's EFFECTIVE mode (stricter of the chosen
   * mode and the strictness ceiling), read at every permission request. Absent ⇒ `ask` (Move 1's behaviour).
   */
  runMode?: (hsid: string, repoKey: string) => { effective: RunMode; source?: string; ceiling?: RunMode } | null;
  watchMs?: number;
  /** TEST RIG ONLY (the fake claude is a #! wrapper): accept a script binary. The daemon never sets it. */
  allowScripts?: boolean;
  /**
   * TD-2026-10-19-063: an open refused claude_binary_changed pre-stages the re-pin card (runner/repin-card.ts);
   * resolves its cardId (null: none raised), which the refusal names for the GUI's [Re-pin]. A failure is ignored.
   */
  onClaudeBinaryChanged?: (sourceReal: string, found: string | null) => Promise<{ cardId: string | null; next?: string }>;
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
  /** 8.0:model-switch: how long a switch waits for set_model's answer (default MODEL_SWITCH_TIMEOUT_MS) */
  modelSwitchTimeoutMs?: number;
  /**
   * A Paradigm-logger-shaped port (`logger.component('#session-runner').warn(…)`) for failures the kernel log has no
   * row for (e.g. a permit release that failed). The kernel takes no logger dependency (G-SEC-01); omitted ⇒ silent.
   */
  logger?: SupervisorLogger;
  /**
   * #git-verbs / #kernel-mcp (T-2026-10-23-002): the kernel-run git verbs. Present ⇒ every Claude session gets the
   * kernel's own SDK MCP server `gnomon` (gnomon_git_init, gnomon_git_push, gnomon_repo_create) in its mcp.json, the
   * GIT_VERBS_GUIDANCE line in its appended system prompt, and its mcp_message control requests answered here.
   */
  gitVerbs?: GitVerbs;
  /** TEST RIG ONLY: the session scratch base (default the identity's DARWIN_USER_TEMP_DIR) */
  scratchBase?: string;
}

/** Paradigm-logger shaped (the kernel injects it; it never imports the logger package, G-SEC-01). */
export interface SupervisorLogger {
  component(id: string): { warn(message: string, data?: Record<string, unknown>): void; info?(message: string, data?: Record<string, unknown>): void };
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
  /** P8-D86 session.open{runMode}: the mode set for this session at open (written on the session.open row); a looser one is never passed here (it takes a card) */
  runMode?: RunMode;
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
  /** review M2: the outstanding turns' ids, parallel to turnPermits (turn.result{turn} names the latest one it closes) */
  turnIds: string[];
  /**
   * review M2: how many outstanding turns Claude Code has CONSUMED (their user message came back as a replay line,
   * isReplay). A queued message folded into the running turn is replayed before that turn's result, so the result
   * closes every consumed turn; with no replay seen it closes the head only (FIFO). Re-review M-1: probe
   * p-replay-order shows the echo is written on consumption, never on receipt.
   */
  consumedTurns: number;
  /**
   * re-review L-2: replay lines count only once the stream is live (the first system.init after spawn, or the first
   * turn sent): a replay before it (a resumed session's history) never marks an outstanding turn consumed
   */
  replayLive: boolean;
  /**
   * kernel clock (ms) when the last model reply ended, for the #gnomon-voice busy guard (V2a): the main-chain
   * message_stop after an end_turn stop_reason, or the turn's result when that end was not seen
   */
  lastTurnEndAt?: number;
  /**
   * #gnomon-voice busy guard (voice drops fix, 2026-10-20): the main-chain reply of the turn in flight has ENDED
   * (message_stop after an end_turn delta, or an assistant line carrying end_turn). Claude Code can write the turn's
   * result ~30 s later (a Stop hook), so the model is not "streaming" between the two. Cleared by a new main-chain
   * message_start (a Stop-hook continuation streams again), a turn sent, and a result.
   */
  replyDone?: boolean;
  /** the current main-chain message's message_delta said end_turn; its message_stop ends the reply */
  replyEnding?: boolean;
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
  /** P8-D87 manual: the effective mode seen at the last permission request, and whether a plan was approved since manual began */
  lastMode: RunMode | null;
  planApproved: boolean;
  /** model picker: the Claude model this session runs now ('claude' = Claude Code's default); a switch updates it */
  model: string;
  /**
   * 8.0:model-switch: the context in use — the LAST main-chain assistant message's in+cacheRead+cacheWrite+out; null
   * while unknown (a resumed session before its first main-chain message: the guard refuses until one arrives)
   */
  contextTokens: number | null;
  /** the model the stream last said ran (system.init, then each main-chain assistant message's message.model) */
  seenModel: string | null;
  /** a switch in flight (send and a second switch are refused model-switching) */
  switching: { requestId: string; from: string; to: string } | null;
  /** control_response waiters by request id (resolved in #onLine; null on exit) */
  controlWaiters: Map<string, (r: { subtype: string | null; error: string | null; errorCode: string | null } | null) => void>;
  /**
   * after a timeout: which model runs is unknown until the next main-chain message.model reconciles it. `permit` is the
   * switch's fresh spawn permit, HELD meanwhile (Aegis M1): reconcile-to-new swaps it in, reconcile-to-old or the
   * session's exit releases it
   */
  modelUncertain: { from: string; to: string; baseline: string | null; permit: PermitV1 } | null;
  /** #voice-origin: the piece counter (created at the first send). A voice turn's permissions are a typed turn's (TD-2026-10-23-939) */
  voicePieces?: VoicePieceCounter;
  /**
   * ^loop-origin-clamp (loops step 8): set for a session a loop opened (origin 'loop'). No supervisor (Claude) session
   * is a loop session in 8.0 (loop judge/summarize sessions are LocalLane's, surface none); step 10's act sessions set
   * it. While set, only the loop's own trust-card modeRefs auto-pass and every card carries the loop origin.
   */
  loopOrigin?: { loopId: string; runId: string; authoredBy: string; trustCard?: string };
}

/**
 * Aegis round 2 (H, M2): the session's Gnomon-made dirs under the kernel's own temp dir (realpath'd): a 0700 TMPDIR per
 * session (`gnomon-tmp/<hsid-short>`) and a 0700 tool cache per repo key (`gnomon-cache/<16 hex>`). Each level must be
 * a real directory owned by this uid with no group/other bits (a link or a foreign dir is replaced only if absent; else thrown).
 */
export function sessionScratchDirs(hsid: string, repoKey: string, base: string = fs.realpathSync.native(os.tmpdir()), owned?: ScratchOwnership): { tmp: string; cache: string } {
  const real = (() => {
    try {
      return fs.realpathSync.native(base);
    } catch {
      return path.resolve(base);
    }
  })();
  // Aegis round 3 M: the base is never under a shared temp dir every session may write (/private/tmp, /private/var/tmp)
  if (WRITE_TEMP_PATHS.some((t) => real === t || real.startsWith(`${t}/`)) || real === '/tmp' || real.startsWith('/tmp/')) throw new Error(`#session-runner: the scratch base ${real} is a shared temp dir`);
  const mk = (p: string, fresh: boolean): string => {
    let made = false;
    try {
      fs.mkdirSync(p, { mode: 0o700 });
      made = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || !st.isDirectory() || (typeof process.getuid === 'function' && st.uid !== process.getuid()) || (st.mode & 0o077) !== 0) throw new Error(`#session-runner: ${p} is not a private directory of this user`);
    // Aegis round 3 M: a session's own dir (its TMPDIR, its cache) must be one this kernel made: made now, or in the
    // kernel-held record with the same inode (a resumed session's TMPDIR, a repo's cache from an earlier session)
    if (fresh && !made && (!owned || !owned.has(p, st.ino))) throw new Error(`#session-runner: ${p} already exists and was not made by this kernel`);
    if (made) owned?.add(p, st.ino);
    return p;
  };
  const tmp = mk(path.join(mk(path.join(real, 'gnomon-tmp'), false), hsidShort(hsid)), true);
  const cache = mk(path.join(mk(path.join(real, 'gnomon-cache'), false), repoKey.replace(/^sha256:/, '').slice(0, 16)), true);
  return { tmp, cache };
}

/** Aegis round 3 M: the kernel-held record of the session scratch dirs it made (path → inode), under the Gnomon home. */
export interface ScratchOwnership {
  has(p: string, ino: number): boolean;
  add(p: string, ino: number): void;
}

/** The record as a 0600 JSON file the kernel alone writes (the Gnomon home is session read- and write-denied). */
export function scratchOwnershipFile(file: string): ScratchOwnership {
  const read = (): Record<string, number> => {
    try {
      const v = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {};
    } catch {
      return {};
    }
  };
  return {
    has: (p, ino) => read()[p] === ino,
    add: (p, ino) => {
      const m = read();
      m[p] = ino;
      const keys = Object.keys(m);
      for (const k of keys.slice(0, Math.max(0, keys.length - 4096))) delete m[k];
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(m), { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
  };
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
  ensureClaudeDir(userClaudeDir, CLAUDE_TRANSCRIPTS_REL);
}

/**
 * Aegis H1/M1: pre-create THIS session's `session-env/<uuid>` (0700) before the spawn, so both literal re-denies name
 * real dirs and the session never has to create (or can remove/swap) them. lstat first: a link, or a non-directory, at
 * `session-env` or `session-env/<uuid>` is refused and left alone (the policy then withholds the carve-back, fail
 * closed). Returns the refusal reason, or null.
 */
export function ensureSessionEnvDir(userClaudeDir: string, uuid: string): string | null {
  if (!SESSION_UUID_RE.test(uuid)) return 'malformed session uuid';
  const root = path.join(userClaudeDir, CLAUDE_SESSION_ENV_REL);
  for (const dir of [root, path.join(root, uuid)]) {
    let st: fs.Stats | null = null;
    try {
      st = fs.lstatSync(dir);
    } catch {
      st = null;
    }
    if (st && (st.isSymbolicLink() || !st.isDirectory())) return `${dir} is ${st.isSymbolicLink() ? 'a symlink' : 'not a directory'}`;
    // Aegis L-2: an existing dir must be ours and not group/world-writable, else another user could plant an env file
    // (win32: mode bits mean nothing there; the dir's owner and DACL are read instead, privateToUser)
    const uid = process.getuid?.();
    if (st && uid !== undefined && st.uid !== uid) return `${dir} is owned by uid ${st.uid}, not ${uid}`;
    if (st && !privateToUser(dir, st)) return process.platform === 'win32' ? `${dir} is not private to this user (owner or DACL)` : `${dir} is group- or world-writable (mode ${(st.mode & 0o777).toString(8)})`;
    if (!st) {
      try {
        fs.mkdirSync(dir, { mode: 0o700 });
      } catch (e) {
        return `cannot create ${dir}: ${(e as NodeJS.ErrnoException).code ?? 'error'}`;
      }
    }
  }
  return null;
}

/**
 * Aegis M-B: empty THIS session's `session-env/<uuid>` when the session ends (exited, drained, killed, orphaned), so a
 * leftover CLAUDE_ENV_FILE can never be sourced by a later process that reuses the id (a `--resume` outside Gnomon, or
 * without the carve). Never follows a link: every entry is lstat'd; files and symlinks are unlinked (unlinking a link
 * removes the link, never its target); a real sub-directory is emptied the same way and removed; nothing is traversed
 * through a link. The `<uuid>` dir itself stays (it is literal-denied while a session runs; the next spawn reuses it).
 * Refuses (does nothing) when `session-env` or `session-env/<uuid>` is a link or not a directory. Never throws.
 */
export function emptySessionEnvDir(userClaudeDir: string, uuid: string): { removed: number; refused?: string } {
  if (!SESSION_UUID_RE.test(uuid)) return { removed: 0, refused: 'malformed session uuid' };
  const root = path.join(userClaudeDir, CLAUDE_SESSION_ENV_REL);
  const dir = path.join(root, uuid);
  for (const d of [root, dir]) {
    try {
      const st = fs.lstatSync(d);
      if (st.isSymbolicLink() || !st.isDirectory()) return { removed: 0, refused: `${d} is ${st.isSymbolicLink() ? 'a symlink' : 'not a directory'}` };
    } catch {
      return { removed: 0 }; // nothing to empty
    }
  }
  let removed = 0;
  const empty = (d: string, depth: number): void => {
    let names: string[];
    try {
      names = fs.readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      const p = path.join(d, name);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(p);
      } catch {
        continue;
      }
      try {
        if (st.isDirectory() && !st.isSymbolicLink()) {
          if (depth < 8) empty(p, depth + 1);
          fs.rmdirSync(p);
        } else {
          fs.unlinkSync(p);
        }
        removed++;
      } catch {
        // best effort: a file we cannot remove stays; the next spawn's policy still scopes the carve to the new run
      }
    }
  };
  empty(dir, 0);
  return { removed };
}

function ensureClaudeDir(userClaudeDir: string, rel: string): void {
  const dir = path.join(userClaudeDir, rel);
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
  /** Aegis M2: the kernel git verbs, never on win32 (its session profile has no .git / kernel-worktree denies yet) */
  readonly #gitVerbs: GitVerbs | undefined;
  readonly #identity: SessionIdentity | null;
  readonly #sessionPath: string | null;
  /** Aegis M: the in-home node dir on the session PATH is write-denied in every session profile */
  readonly #pathDenies: PolicyPath[];
  readonly #local: LocalLane;
  /** §2.4 rule 11: set once a drain begins; session.open and session.send are refused ENGINE{draining} from then on */
  #drain: Promise<DrainReport> | null = null;
  /** §2.4 rule 11 (B2): hsids this kernel resumed after an upgrade */
  readonly #resumed = new Set<string>();
  /** Claude opens past the draining check and not yet settled: the drain waits for them before it collects sessions */
  #opening = 0;
  /** woken at every turn boundary (a result line), session exit and settled open */
  readonly #boundaryWaiters = new Set<() => void>();

  /**
   * The per-turn guidance for an hsid, late-bound: table talk (TD-2026-10-20-294) and the Desk (TD-2026-10-20-812)
   * composed into ONE block by desk-guidance.ts composeGuidance (trace-cli extrasAgree admits exactly one extra block).
   */
  #turnGuidance: (hsid: string) => string | null = () => null;

  /** Wire the composite per-turn guidance source (the daemon builds VoiceControl and the offer router after the supervisor). */
  setTurnGuidance(f: (hsid: string) => string | null): void {
    this.#turnGuidance = f;
  }

  /** The voice-only form (table talk before the Desk): the same single-block source. */
  setVoiceGuidance(f: (hsid: string) => string | null): void {
    this.setTurnGuidance(f);
  }

  constructor(o: SupervisorOptions) {
    this.#o = o;
    this.#platform = o.platform ?? process.platform;
    this.#gitVerbs = this.#platform === 'win32' ? undefined : o.gitVerbs;
    // the session identity is resolved ONCE, at daemon start, from the OS (runner/env.ts), never from the daemon's env
    this.#identity = (o.identity ?? sessionIdentity)();
    // TD-2026-10-21-077: the session PATH, once: config, else the per-platform default (the running node's dir, an OS fact)
    // TD-2026-10-21-077/-162: the session PATH (config, else the default headed by the node dir's realpath), then every
    // user-writable dir on it is write-denied in every session profile (planSessionPath); win32 keeps the allowlist
    const nodeDir = sessionNodeDir(o.nodeExecPath ?? process.execPath);
    const joined = sessionPathFor(o.sessionPath, { ...(nodeDir ? { nodeDir } : {}), home: this.#userHome() });
    if (joined === null || process.platform === 'win32') {
      this.#sessionPath = joined;
      this.#pathDenies = [];
    } else {
      const plan = planSessionPath(joined.split(':'), { home: this.#userHome() });
      this.#sessionPath = plan.dirs.join(':');
      this.#pathDenies = plan.denies.map((p) => ({ path: realpathLoose(p), match: 'subpath', class: 'persistence' }));
    }
    // Aegis ruling 3: one row at daemon start when the OS identity is incomplete (names only, no error text)
    const missing = missingIdentity(this.#identity);
    if (missing.length) void Promise.resolve().then(() => o.log('session.sandbox', { phase: 'identity', missing })).catch(() => undefined);
    this.#local = new LocalLane({
      log: o.log, children: o.children, fuse: o.fuse, ...(o.broker ? { broker: o.broker } : {}), home: o.home, ...(o.userHome ? { userHome: o.userHome } : {}), identity: this.#identity, sessionPath: this.#sessionPath, pathDenies: this.#pathDenies,
      kernelPrincipal: o.kernelPrincipal, sock: o.sock, ...(o.env ? { env: o.env } : {}), ...(o.endpointPort ? { endpointPort: o.endpointPort } : {}),
      ...(o.linkedFolders ? { linkedFolders: o.linkedFolders } : {}), platform: this.#platform, ...(o.macosMajor ? { macosMajor: o.macosMajor } : {}),
      ...(o.sipEnabled ? { sipEnabled: o.sipEnabled } : {}), ...(o.local ? { config: o.local } : {}), ...(o.localProbeFetch ? { probeFetch: o.localProbeFetch } : {}),
    });
  }

  /** Aegis L2: the user home is the OS one (passwd), never $HOME; the userHome seam still wins (tests, the daemon's own) */
  /**
   * Aegis M-B: empty a session's `session-env/<uuid>` (see emptySessionEnvDir). Public for the daemon's orphan sweep,
   * which ends sessions a crashed kernel left behind. Logged; never throws.
   */
  async emptySessionEnvFor(hsid: string | null, uuid: string): Promise<void> {
    await this.#emptySessionEnv(hsid, uuid);
  }

  async #emptySessionEnv(hsid: string | null, uuid: string): Promise<void> {
    const row = claudeCodePlatform(this.#platform);
    if (!row) return;
    const r = emptySessionEnvDir(path.join(this.#userHome(), row.userClaudeDir), uuid);
    if (r.removed > 0 || r.refused) await this.#o.log('session.sandbox', { hsid, phase: 'session-env-emptied', uuid, removed: r.removed, ...(r.refused ? { refused: r.refused } : {}) }, hsid ? { session: hsid } : {}).catch(() => undefined);
    if (this.#platform === 'win32' && SESSION_UUID_RE.test(uuid)) {
      // W5: the dir's own-SID allow-write-keep (platform/win32/session-sandbox.ts) ends with the session
      try {
        releaseSessionGrants([path.join(this.#userHome(), row.userClaudeDir, CLAUDE_SESSION_ENV_REL, uuid)]);
      } catch (err) {
        await this.#o.log('session.sandbox', { hsid, phase: 'session-env-grant-kept', uuid, error: err instanceof Error ? err.message : String(err) }, hsid ? { session: hsid } : {}).catch(() => undefined);
      }
    }
  }

  /** W5: undo this session's win32 labels and grants (platform/win32/session-sandbox.ts releaseSession); logged, never throws. */
  #releaseWin32(hsid: string): void {
    try {
      releaseSession(sessionSidFor(hsid));
    } catch (err) {
      void this.#o.log('session.sandbox', { hsid, phase: 'release-failed', error: err instanceof Error ? err.message : String(err) }, { session: hsid }).catch(() => undefined);
    }
  }

  #userHome(): string {
    return this.#o.userHome ?? this.#identity?.home ?? os.homedir();
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

  /**
   * Loops step 8 (docs/specs/gnomon-loops.md §3.4, §3.6): the ONE unattended open, and only through here. A trusted
   * loop run's judge/summarize step opens a local session (origin 'loop') with the run reference the runner got from
   * the registry; LocalLane.openLoop refuses anything else (FORBIDDEN) and never falls back to Claude. open() keeps
   * its blanket refusal of every other unattended open (law 5).
   */
  async openLoop(ref: LoopRunRef, req: LoopOpenRequest): Promise<LoopSessionHandle> {
    this.#refuseIfDraining('session.open');
    this.#opening++;
    try {
      return await this.#local.openLoop(ref, req);
    } finally {
      this.#opening--;
      this.#wake();
    }
  }

  /** Is this a loop session (origin 'loop', LL5)? */
  /** Step 10: every loop session of a run has exited (LocalLane.loopSessionsSettled). */
  loopSessionsSettled(runId: string): Promise<void> {
    return this.#local.loopSessionsSettled(runId);
  }

  isLoopSession(hsid: unknown): boolean {
    return this.#local.isLoopSession(hsid);
  }

  async #open(req: OpenRequest): Promise<{ hsid: string; principalId: string; backend: 'claude-code' | 'local'; state: string; binaryPin?: string; model?: string }> {
    // law 5: no unattended or non-human open here; a loop step's unattended local session is openLoop() alone
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
    // model picker (Aegis): a Claude model is an allow-listed alias or a strict id; refused before any row or spawn
    if (req.model !== undefined && req.model !== 'claude' && req.model !== 'any') {
      const why = claudeModelProblem(req.model);
      if (why !== null) throw refused('BAD_REQUEST', `session.open: ${why}`, { reason: 'bad-params', field: 'model' });
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
    const userHome = this.#userHome();
    await this.#o.log('session.open', { hsid, principalId, by: req.principal, cwd: req.cwd, worktree: req.worktree ?? null, backend: 'claude-code', model: req.model ?? 'claude', attended: true, uuid, principalClass: req.principalClass, ...(req.runMode ? { runMode: req.runMode } : {}), ...(r ? { resume: { drainedEventId: r.drainedEventId, outcome: r.outcome } } : {}) }, { session: hsid });
    const row = claudeCodePlatform(this.#platform);
    if (!row) return this.#refuse(hsid, 'spawn_failed', `no Claude Code platform row for ${this.#platform}`);
    const dir = path.join(this.#o.home, 'sessions', hsidShort(hsid));
    // reviewer 9: the child's HOME IS the user home whose layers were scanned
    const { env, envKeys } = buildSessionEnv({ from: { ...(this.#o.env?.() ?? process.env), HOME: userHome }, hsid, sock: this.#o.sock, sessionKeyPath: path.join(dir, 'session.key'), identity: this.#identity, path: this.#sessionPath, ...(this.#platform === 'win32' ? { tempDir: win32SessionTempDir(hsid) } : {}), ...(repoContextFor(this.#o.hooksMode ?? DEFAULT_SESSION_HOOKS) ? { inject: REPO_CONTEXT_ENV } : {}) });
    // Aegis round 2 (H, M1, M2, M6): a darwin Claude session gets a Gnomon-made 0700 TMPDIR of its own and a Gnomon-made
    // tool cache per repo (never the human's ~/.npm, ~/.cache…), and Claude Code's non-essential traffic is off. The OS
    // TMPDIR is kept for the screen-socket deny (osTmp).
    const osTmp = env.TMPDIR;
    // Aegis round 3 M: the base is the per-user DARWIN_USER_TEMP_DIR the identity resolved (never os.tmpdir()'s /tmp fallback)
    const scratch = this.#platform === 'darwin' ? sessionScratchDirs(hsid, repoKeyOf([req.cwd, ...(req.worktree ? [req.worktree] : [])]), this.#o.scratchBase ?? this.#identity?.tmpdir ?? os.tmpdir(), scratchOwnershipFile(path.join(this.#o.home, 'scratch-owned.json'))) : null;
    if (scratch) {
      env.TMPDIR = scratch.tmp;
      for (const [k, sub] of Object.entries(SESSION_CACHE_ENV)) env[k] = path.join(scratch.cache, sub);
    }
    if (this.#platform !== 'win32') env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
    let permit: PermitV1 | null = null;
    let child: ChildProcess | null = null;
    let tracked = false;
    let live: Session | null = null;
    let trace: TraceStream | null = null;
    let traceRefused: string | null = null;
    try {
      const bin = resolveClaudeBinary({ ...(this.#o.claudePath ? { explicit: this.#o.claudePath } : {}), row, home: userHome });
      const priv = await prepareClaude(this.#o.home, bin.real, { allowScripts: this.#o.allowScripts === true }).catch(async (e: unknown) => {
        if (!(e instanceof PreflightRefusal) || e.code !== 'claude_binary_changed' || !this.#o.onClaudeBinaryChanged) throw e;
        const found = typeof e.data.found === 'string' ? e.data.found : null;
        const r = await this.#o.onClaudeBinaryChanged(bin.real, found).catch(() => ({ cardId: null }) as { cardId: string | null; next?: string });
        const message = r.next ? `the claude binary differs from the pinned sha256 — ${r.next}` : e.message.replace(/^#session-runner: /, '');
        throw new PreflightRefusal(e.code, message, { ...e.data, ...(r.cardId ? { cardId: r.cardId } : {}), ...(r.next ? { next: r.next } : {}) });
      });
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
      const sessionEnvPrep = ensureSessionEnvDir(userClaudeDir, uuid);
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
        extraDenyWrite: [...binaryDenies(row, userHome, bin.real, this.#o.claudePath), ...this.#pathDenies, ...(this.#o.mcpDenyWrite?.({ cwd: req.cwd, ...(req.worktree ? { worktree: req.worktree } : {}) }) ?? [])],
        // round 3 (Aegis H1): a Claude session can no more swap the local runner's node or source than a local one
        ...((r) => (r ? { localRunner: { node: r.node, dir: r.dir } } : {}))(this.#local.config()?.runner),
        // T-2026-10-18-010: the home is read-denied; only this session's dir and the private copy it execs are readable
        homeReadable: [{ path: dir, match: 'subpath' }, { path: priv.exec, match: 'literal' }],
        // #git-verbs: kernel worktrees under the roots (darwin; the win32 backend has no regex deny yet)
        ...(this.#gitVerbs && this.#platform === 'darwin' ? { kernelWorktrees: true } : {}),
        ...((m) => ({ memoryDirs: m.chain, memorySubtree: m.top }))(memoryChainOf(req.cwd, userHome)), // P8-D97 (M1, R1): no session plants steering a later one loads
        memoryImports: repoCtx?.importTargets ?? [], // P8-D97 (F3)
        claudeTranscripts: true, // TD-2026-10-19-814 item 1: Claude Code saves transcripts under ~/.claude/projects (--resume)
        claudeSessionEnv: uuid, // Aegis H1: only THIS session's ~/.claude/session-env/<uuid> (Claude Code mkdirs it before any command hook)
        // T-2026-10-23-004: deny-by-default writes — the session's own TMPDIR (its per-user /private/var/folders dir) is writable
        ...(this.#platform !== 'win32' && env.TMPDIR ? { tmpdir: env.TMPDIR } : {}),
        ...(scratch ? { sessionCache: scratch.cache } : {}),
        // TEST RIG ONLY (allowScripts; the daemon never sets it): the fake claude writes its trace one level above its bin dir
        ...(this.#o.allowScripts && this.#o.claudePath ? { testWriteAllow: [path.dirname(path.dirname(this.#o.claudePath))] } : {}),
      });
      // fail closed, reported: no transcript carve-back means this session cannot be resumed
      if (policy.allowWriteRefused) await this.#o.log('session.sandbox', { hsid, phase: 'transcripts-withheld', reason: policy.allowWriteRefused }, { session: hsid });
      // fail closed, reported: no session-env carve-back means Claude Code's command hooks cannot run in this session
      if (policy.sessionEnvRefused || sessionEnvPrep) await this.#o.log('session.sandbox', { hsid, phase: 'session-env-withheld', reason: policy.sessionEnvRefused ?? sessionEnvPrep }, { session: hsid });
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
      // Aegis round 2 H: the session cache vars also ride the settings env block Claude Code applies to every tool process,
      // so a tool sees them even where Claude Code does not pass its own env through (belt and braces; p10m-write-allow)
      const perms = claudePermissions(policy, this.#platform);
      const cacheEnv = scratch ? Object.fromEntries(Object.keys(SESSION_CACHE_ENV).map((k) => [k, env[k]!])) : {};
      fs.writeFileSync(policyPath, `${JSON.stringify({ ...perms, env: { ...perms.env, ...cacheEnv }, ...(repoCtx ? REPO_CONTEXT_SETTINGS : {}), ...(hooks ? { hooks } : {}) }, null, 2)}\n`, { mode: 0o600 });
      const distroServers = (mcpJson.mcpServers as Record<string, unknown> | undefined) ?? {}; // verified generated (kernel output)
      const desk = this.#o.deskMcp ? this.#o.deskMcp(distroServers, { hsid, cwd: req.cwd, ...(req.worktree ? { worktree: req.worktree } : {}) }) : distroServers;
      // #kernel-mcp: the kernel's own SDK server, last, so no distro or mod server can take its name
      const mcpServers = this.#gitVerbs ? { ...desk, [KERNEL_MCP_SERVER]: { ...KERNEL_MCP_ENTRY } } : desk;
      fs.writeFileSync(mcpConfigPath, `${JSON.stringify({ mcpServers }, null, 2)}\n`, { mode: 0o600 });
      // the screen-socket deny follows the TMPDIR the session actually gets (the OS one), not the daemon's inherited one
      const extras: DarwinSessionExtras = { uid: process.getuid?.() ?? 0, tmpdir: (this.#platform === 'win32' ? env.TEMP : (osTmp ?? env.TMPDIR)) ?? DARWIN_SCREEN_TMP_FALLBACK, home: userHome, roots: [req.cwd, ...(req.worktree ? [req.worktree] : [])] };
      // Aegis H1: preflight runs the PRIVATE copy under the session profile, never unsandboxed
      const run: ClaudeRun = (args) =>
        new Promise((resolve) => {
          const p = sessionLaunchPlan({ policy, binaryReal: priv.exec, argv: args, extras, hsid }, this.#platform, this.#o.macosMajor, this.#o.sipEnabled);
          const ch = spawn(p.command, p.args, { cwd: req.cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
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
      await claudeAuthOk(run).catch((e: unknown) => {
        // Aegis ruling 3: Claude Code finds its keychain item by $USER — name the cause when the OS gave none (never back-filled)
        if (e instanceof PreflightRefusal && e.code === 'not_subscription_auth' && this.#identity && !this.#identity.user) {
          throw new PreflightRefusal(e.code, `${e.message.replace(/^#session-runner: /, '')} — the OS gave no user name for this uid, so the session has no USER and Claude Code cannot find its keychain login`, { ...e.data, missing: ['USER'] });
        }
        throw e;
      });
      // Aegis N1: trust on first use — the pin is written only after the sandboxed preflight passed
      commitPin(this.#o.home, priv);
      await this.#o.log('session.sandbox', { hsid, phase: 'binary-pin', pin: priv.pin, by: priv.pin === 'repin' ? 'repin' : priv.pin === 'first-use' ? 'first-use' : 'pinned', ...(priv.repin ? { from: priv.repin.from, to: priv.repin.to, ...(priv.repin.cardId ? { cardId: priv.repin.cardId } : {}) } : {}), binarySha256: `sha256:${priv.sha256}`, source: bin.real }, { session: hsid });
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
      const argv = buildClaudeArgv({ uuid, ...(r ? { resume: true } : {}), policyPath, mcpConfigPath, settingSources, ...(repoCtx ? { pluginDirs: repoCtx.pluginDir ? [repoCtx.pluginDir] : [], addDirs: repoCtx.memoryDirs } : {}), ...((): { appendSystemPrompt?: string } => { const sp = [req.systemPrompt, this.#gitVerbs ? GIT_VERBS_GUIDANCE : undefined].filter((x): x is string => typeof x === 'string' && x.length > 0); return sp.length ? { appendSystemPrompt: sp.join('\n\n') } : {}; })(), ...(req.model && req.model !== 'claude' && req.model !== 'any' && req.model !== 'default' ? { model: req.model } : {}) });
      const plan = sessionLaunchPlan({ policy, binaryReal: priv.exec, argv, extras, hsid }, this.#platform, this.#o.macosMajor, this.#o.sipEnabled);
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
          trace = openTraceStream(this.#o.home, req.cwd, hsid, { ...this.#o.traceOptions, secrets: Object.entries(env).filter(([k, v]) => SECRET_ENV.test(k) && typeof v === 'string').map(([, v]) => v) });
          trace.ctl({ event: 'spawn', argv: redactArgv(argv), envKeys, ...(r ? { resume: r.uuid } : {}) });
        } catch (e) {
          traceRefused = e instanceof TraceRefused ? e.reason : 'trace-unavailable';
        }
      }
      const intent = await this.#o.children.intend({ kind: 'session', hsid });
      child = spawn(plan.command, plan.args, { cwd: req.cwd, env, detached: this.#platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); // win32: stay in libuv's kill-on-close job (a dead kernel takes the launcher, so the session, with it)
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
        hsid, uuid, principalId, owner: req.principal, cwd: req.cwd, ...(req.worktree ? { worktree: req.worktree } : {}), child: c, exited, spawnPermit: permit, turnPermits: [], turnIds: [], consumedTurns: 0, replayLive: false,
        watchHash: wHash, gitHash: gHash, layerInput, env, state: 'running', turns: 0, seq: 0, meter: new UsageMeter(), stderrBytes: 0, watch: null, pending: new Map(), toolNames: new Map(), requested: new Set(), planUses: new Map(), lastPlanFile: null, policy, trace, lastMode: null, planApproved: false, model: req.model && req.model !== 'any' && req.model !== 'default' ? req.model : 'claude',
        contextTokens: r ? null : 0, seenModel: null, switching: null, controlWaiters: new Map(), modelUncertain: null,
      };
      this.#sessions.set(hsid, s);
      live = s;
      this.#wire(s); // round 3: wired BEFORE any further await — a failing row below still cleans up through the exit path
      await this.#o.log('session.sandbox', {
        hsid, sandbox: plan.sandbox, ...(plan.partial?.length ? { partial: [...plan.partial] } : {}), profile: 'session', profileHash: plan.profileHash, policyHash: policyHash(policy), layersHash: lHash, gitHash: gHash,
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
      // W5: an open that failed before a live session undoes its win32 labels and grants (a live one does at exit)
      if (this.#platform === 'win32' && !live) this.#releaseWin32(hsid);
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
    // Aegis M-B: every exit path (exited, drained, killed) empties this session's session-env/<uuid>, links never followed
    await this.#emptySessionEnv(s.hsid, s.uuid);
    if (this.#platform === 'win32') this.#releaseWin32(s.hsid);
    if (s.watch) clearInterval(s.watch);
    s.watch = null;
    await this.#expirePending(s, 'session-exited');
    for (const w of [...s.controlWaiters.values()]) w(null); // a switch in flight learns the session is gone
    s.controlWaiters.clear();
    for (const p of [s.spawnPermit.permitId, ...s.turnPermits]) await this.#o.fuse.release(p, s.owner).catch(() => undefined);
    s.turnPermits = [];
    s.turnIds = [];
    s.consumedTurns = 0;
    await this.#dropUncertain(s, 'session-exited'); // Aegis M1: a timed-out switch's held permit ends with the session
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
    // Aegis M2: a hook line's facts (id, event, name, exit, outcome, blocked) come from the FULL line, before it is
    // stored by hash or rewritten, and ride as kernel-set fields: a hook printing past EVENT_LINE_CAP cannot hide a block
    const hook = ev.type === 'system.hook_started' || ev.type === 'system.hook_response' ? hookFactsOf(line) : null;
    // Aegis L2: a hook_response keeps its stdout / stderr / output inline only up to HOOK_OUTPUT_INLINE_CAP each,
    // secret-shaped spans redacted (trace's redactText), else {bytes, sha256}; output dropped when it is stdout + stderr.
    // The row then carries the received line's hash and size too (S2 evidence; a traced session has the raw line)
    // Aegis 2026-10-23: Claude's synthetic user line (Stop hook feedback: the hook's reason fed back to the model) is
    // hook output too: the same cap and redaction, and the row says `synthetic: true` (the session-reader rule keys on it)
    const kept = ev.type === 'system.hook_response' ? hookStoredLine(line, (t) => redactText(t)) : ev.kind === 'user' ? syntheticStoredLine(line, (t) => redactText(t)) : null;
    const synthetic = ev.kind === 'user' && kept !== null;
    const stored = kept?.line ?? line;
    // S2: every driver event is a turn.event before anything acts on it; big lines by hash (Aegis M3)
    await this.#o.log('turn.event', {
      hsid: s.hsid, type: ev.type, seq: ++s.seq,
      // Aegis A4: a control_request line (can_use_tool carries the tool input) is logged by hash only, never its text
      ...(Buffer.byteLength(stored) > EVENT_LINE_CAP || ev.type.startsWith('control_request') ? { lineHash: sha(line), bytes } : { line: stored }),
      ...(kept ? { lineHash: sha(line), bytes, lineKept: { ...(kept.hashed.length ? { hashed: kept.hashed } : {}), ...(kept.dropped.length ? { dropped: kept.dropped } : {}), ...(kept.redacted ? { redacted: kept.redacted } : {}) } } : {}),
      ...(hook ? { hook } : {}),
      ...(synthetic ? { synthetic: true } : {}),
      ...(ev.kind === 'init' ? { apiKeySource: ev.apiKeySource ?? 'absent' } : {}),
    }, { session: s.hsid });
    const usage = async (source: 'turn.usage' | 'turn.result', tokens: number, extra: Record<string, unknown> = {}): Promise<void> => {
      if (source === 'turn.usage' && tokens <= 0) return;
      await this.#o.log(source, { hsid: s.hsid, usage: { tokens }, ...extra }, { session: s.hsid });
      await this.#o.fuse.recordStreamUsage({ source, permitId: s.spawnPermit.permitId, hsid: s.hsid, tokens });
    };
    switch (ev.kind) {
      case 'init':
        s.replayLive = true; // re-review L-2
        // L1: the session-env carve-back covers only the uuid it was spawned with. A different live id (/clear mints one;
        // a forking resume would too) means Claude Code's command hooks are back on fail-closed EPERM — say so.
        if (ev.sessionId !== null && ev.sessionId !== s.uuid) await this.#o.log('session.sandbox', { hsid: s.hsid, phase: 'session-env-mismatch', uuid: s.uuid, sessionId: ev.sessionId, hooks: 'fail-closed' }, { session: s.hsid });
        if (ev.model !== null) s.seenModel = ev.model;
        if (ev.apiKeySource !== null && ev.apiKeySource !== 'none') {
          await this.#o.log('billing.api.refused', { hsid: s.hsid, where: ['init.apiKeySource'], keys: [ev.apiKeySource] }, { session: s.hsid });
          await this.#stopSession(s, 'api-key-source');
        }
        return;
      case 'partial':
        if (ev.parentToolUseId === null) this.#replyEdge(s, ev.type, ev.stopReason);
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
        if (ev.parentToolUseId === null && ev.stopReason !== null) {
          // voice busy guard: an assistant line carrying its stop_reason (no partial stream): end_turn ends the reply,
          // any other stop (tool_use) means the turn goes on
          if (ev.stopReason === 'end_turn') this.#replyEnded(s);
          else s.replyDone = false;
        }
        if (ev.parentToolUseId === null) {
          // 8.0:model-switch: the main chain's context (a subagent's message is not) and the model that actually ran
          if (ev.tokens !== null) s.contextTokens = ev.tokens;
          if (ev.model !== null) await this.#reconcileModel(s, ev.model);
        }
        if (ev.quota) await this.#o.fuse.quotaError(s.hsid);
        return;
      case 'result': {
        // reviewer 7: FIFO — this result closes the oldest turn; review M2: and every later turn Claude Code already
        // consumed (a queued message folded into the running turn is replayed before this result). turn.result{turn}
        // names the latest turn it closes.
        // re-review M-1, probe p-replay-order (claude 2.1.305, probes/results/p-replay-order.darwin.json): the replay
        // line is written on CONSUMPTION, never on receipt. B sent during A's Bash call is echoed after A's tool_result,
        // just before the message that answers both, and one result (num_turns 2) closes both; B sent after A's final
        // message_stop, back to back with A, or inside a Stop-hook continuation is echoed after A's result, right before
        // its own message_start, with its own result. So a consumed turn really is folded into this result.
        if (s.turnIds.length === 0 && s.turnPermits.length === 0) {
          // re-review M-1: a result with no outstanding turn is a stream shape we do not expect (names only)
          await this.#o.log('session.anomaly', { hsid: s.hsid, why: 'result-without-turn' }, { session: s.hsid });
        }
        const k = Math.min(Math.max(1, s.consumedTurns), Math.max(s.turnPermits.length, s.turnIds.length, 1));
        const closedIds = s.turnIds.splice(0, k);
        const closedPermits = s.turnPermits.splice(0, k);
        s.consumedTurns = Math.max(0, s.consumedTurns - k);
        const turn = closedIds[closedIds.length - 1];
        await usage('turn.result', s.meter.result(ev.tokens), { cost: ev.costUsd, permission_denials: ev.permissionDenials, subtype: ev.subtype, isError: ev.isError, ...(ev.split ? { split: ev.split } : {}), ...(turn !== undefined ? { turn } : {}) });
        // voice busy guard: the reply's end is its message_stop when it was seen (the result may be ~30 s late);
        // the result is the fallback end. A turn still outstanding after this result streams next (re-armed).
        if (!s.replyDone) s.lastTurnEndAt = Date.now();
        s.replyDone = false;
        s.replyEnding = false;
        for (const head of closedPermits) await this.#o.fuse.release(head, s.owner).catch(() => undefined);
        this.#wake(); // §2.4 rule 11: a turn boundary
        if (ev.quota) await this.#o.fuse.quotaError(s.hsid);
        return;
      }
      case 'permission-request':
        if (ev.toolUseId !== null) boundedSet(s.requested, ev.toolUseId);
        await this.#onPermission(s, ev);
        return;
      case 'user':
        // review M2: a replayed human message (no tool results) is Claude Code consuming the next outstanding turn
        // re-review L-2: not before the stream is live (a resumed session's history replays)
        if (ev.replay && ev.toolResults.length === 0 && s.replayLive) {
          s.consumedTurns = Math.min(s.consumedTurns + 1, s.turnIds.length);
        }
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
      case 'control': {
        // 8.0:model-switch: the set_model answer, matched by request id (any other control_response is only logged)
        const w = ev.requestId !== null ? s.controlWaiters.get(ev.requestId) : undefined;
        if (w) {
          s.controlWaiters.delete(ev.requestId!);
          w({ subtype: ev.subtype, error: ev.error, errorCode: ev.errorCode });
        }
        return;
      }
      case 'mcp-message':
        // #kernel-mcp: answered OUTSIDE the stdout queue (a push waits on its card); exactly one answer per request
        void this.#onMcp(s, ev).catch(() => undefined);
        return;
      case 'control-request-unknown':
        if (ev.requestId !== null) await this.#write(s, controlErrorLine(ev.requestId, `unsupported control request: ${ev.subtype.slice(0, 64)}`), { answer: 'error', requestId: ev.requestId });
        return;
      default:
        return; // user replays, control responses, unknown types and malformed lines: logged above, never acted on
    }
  }

  /** #kernel-mcp: one JSON-RPC message to the kernel's own `gnomon` SDK server (any other server name: a control error). */
  async #onMcp(s: Session, ev: Extract<AdapterEvent, { kind: 'mcp-message' }>): Promise<void> {
    const verbs = this.#gitVerbs;
    if (!verbs || ev.serverName !== KERNEL_MCP_SERVER) {
      await this.#write(s, controlErrorLine(ev.requestId, `no sdk mcp server named ${ev.serverName.slice(0, 64)}`), { answer: 'error', requestId: ev.requestId, channel: 'kernel-mcp' });
      return;
    }
    const answer = await kernelMcpAnswer(ev.message, verbs, () => (s.state === 'running' ? this.#verbSession(s) : null));
    await this.#write(s, mcpResponseLine(ev.requestId, answer), { answer: 'mcp', requestId: ev.requestId, channel: 'kernel-mcp' });
  }

  /**
   * The roots an edit is judged against (auto-edits, scoped edit rules): each kernel worktree under the session roots
   * FIRST (so a path inside `.gnomon/worktrees/<name>` is relative to that worktree, its own gate-class files still
   * cards), then the cwd and the worktree root. Worktrees are listed only when this session can have them (#git-verbs).
   */
  #editRoots(s: Session): string[] {
    const roots = [s.cwd, ...(s.worktree ? [s.worktree] : [])];
    return this.#gitVerbs ? [...roots.flatMap((r) => kernelWorktreeDirs(r)), ...roots] : roots;
  }

  /** Aegis M2 (round 1): are the kernel git verbs served to this platform's sessions? Never on win32 (the constructor drops them). */
  kernelVerbsServed(): boolean {
    return this.#gitVerbs !== undefined;
  }

  /** #git-verbs: what a verb needs to know about the session, read now (the effective mode at this call). */
  #verbSession(s: Session): VerbSession {
    const repoKey = repoKeyOf([s.cwd, ...(s.worktree ? [s.worktree] : [])]);
    return { hsid: s.hsid, principalId: s.principalId, cwd: s.cwd, ...(s.worktree ? { worktree: s.worktree } : {}), repoKey, mode: this.#modeTransition(s, repoKey), planApproved: s.planApproved, loop: s.loopOrigin !== undefined, worktreesGuarded: this.#platform === 'darwin' };
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
    // P8-D87 run modes: the EFFECTIVE mode, read now (a change takes effect at the next request)
    const mode = this.#modeTransition(s, repoKey);
    // TD-2026-10-23-939 (#voice-origin): a voice-sent turn gets a typed turn's mode, rules and grants; no voice override.
    // ^loop-origin-clamp: a loop session's mode, read-only, rule and always passes go through loopClampAllows (default deny)
    const loopBy = s.loopOrigin ?? null;
    const mayAuto = (modeRef: string): boolean => (loopBy !== null ? loopClampAllows(modeRef, loopBy.trustCard) : true);
    if (mode === 'manual' && manualHolds(ev.toolName) && !s.planApproved) {
      // manual: writes and exec wait on an approved plan — no card for them until one is approved (§3.4)
      await this.#write(s, permissionDenyLine(requestId, 'Denied: this session is in manual mode. Writes and commands wait on an approved plan: propose one with ExitPlanMode and the human approves it.'), { answer: 'deny', requestId, why: 'mode-manual' });
      return;
    }
    // #kernel-mcp: the kernel's own verb tools carry their own gate (^git-init-gate / ^git-push-gate: run mode, card,
    // Always rules), so their tool permission passes with an approval.auto row (log before effect) and never a second card
    const kernelTool = this.#gitVerbs ? Object.keys(GIT_VERB_TOOLS).find((t) => kernelToolName(t) === ev.toolName) : undefined;
    if (kernelTool !== undefined) {
      let logged = false;
      if (mayAuto('kernel-verb') && b && typeof b.auto === 'function') {
        try {
          await b.auto({ hsid: s.hsid, tool: ev.toolName, inputHash: plan.inputHash, modeRef: 'kernel-verb' });
          logged = true;
        } catch {
          logged = false;
        }
      }
      await this.#write(s, logged ? permissionAllowLine(requestId, structuredClone(ev.input)) : permissionDenyLine(requestId, loopBy !== null ? 'Denied: loop sessions never run kernel verbs.' : 'Denied: no approval surface could take this request.'), { answer: logged ? 'allow' : 'deny', requestId, why: 'kernel-verb' });
      return;
    }
    // the auto-edits pass for an edit request, outside manual mode: auto-edits uses it, and (TD-2026-10-23-939 follow-up,
    // Aegis) it is the ONLY way a scoped edit rule (file / repo-edits) matches or is offered on the card
    // Aegis H1: "edits in this repo" is auto-edits by another name, so it is offered and matched only where the
    // strictness ceiling allows auto-edits (never at L2/L3) and never in manual mode; file rules need only mode ≠ manual
    const repoEdits = mode !== 'manual' && this.#ceilingAllowsAutoEdits(s, repoKey);
    const editPass = mode !== 'manual' && plan.cardKind === 'permission' && EDIT_SCOPE_TOOLS.includes(ev.toolName) ? autoEditPass(ev.toolName, ev.input, this.#editRoots(s), plan.lines, this.#o.platform ?? process.platform, this.#userHome()) : null;
    if (mode === 'auto-edits' && mayAuto('mode:auto-edits') && plan.cardKind === 'permission' && b && typeof b.auto === 'function') {
      const pass = editPass ?? autoEditPass(ev.toolName, ev.input, this.#editRoots(s), plan.lines, this.#o.platform ?? process.platform, this.#userHome());
      if (pass.ok) {
        // log-before-effect: no approval.auto row ⇒ no auto-allow; the request falls through to the card (never unanswered)
        let logged = false;
        try {
          await b.auto({ hsid: s.hsid, tool: ev.toolName, path: pass.path, inputHash: plan.inputHash, modeRef: 'mode:auto-edits' });
          logged = true;
        } catch {
          logged = false;
        }
        if (logged) {
          await this.#write(s, permissionAllowLine(requestId, structuredClone(ev.input)), { answer: 'allow', requestId, why: 'mode', modeRef: 'mode:auto-edits' });
          return;
        }
      }
    }
    if ((mode === 'auto-edits' || mode === 'ask') && mayAuto(mode === 'ask' ? READ_ONLY_ASK_MODE_REF : READ_ONLY_MODE_REF) && plan.cardKind === 'permission' && ev.toolName === 'Bash' && b && typeof b.auto === 'function') {
      // TD-2026-10-20-294 part 1: a PROVABLY read-only command (#shell-readonly; fails closed) passes with no card.
      // F1 (TD-2026-10-20-086): in `ask` too (modeRef mode:ask:read-only); never in `manual`
      const roRef = mode === 'ask' ? READ_ONLY_ASK_MODE_REF : READ_ONLY_MODE_REF;
      // K1: anchored in the claude child's cwd (its realpath): the allow sends the anchored command, which runs there
      const pass = autoBashReadOnly(ev.toolName, ev.input, [s.cwd, ...(s.worktree ? [s.worktree] : [])], plan.lines, this.#o.home, this.#o.platform ?? process.platform, this.#userHome(), { root: s.cwd, ...(s.env.SHELL !== undefined ? { shell: s.env.SHELL } : {}), ...(s.env.PATH !== undefined ? { path: s.env.PATH } : {}) });
      if (pass.ok) {
        // log-before-effect: no approval.auto row ⇒ no auto-allow; the request falls through to the card (never unanswered).
        // inputHash is the REQUEST's (the card's, the rules'); path is where it runs (the anchored root)
        const updated = { ...structuredClone(ev.input), command: pass.command };
        let logged = false;
        try {
          await b.auto({ hsid: s.hsid, tool: ev.toolName, ...(pass.root !== null ? { path: pass.root } : {}), inputHash: plan.inputHash, modeRef: roRef });
          logged = true;
        } catch {
          logged = false;
        }
        if (logged) {
          // both hashes: the request's (as on approval.auto) and the anchored input actually sent (sensitive inject row)
          await this.#write(s, permissionAllowLine(requestId, updated), { answer: 'allow', requestId, why: 'mode', modeRef: roRef, inputHash: plan.inputHash, anchoredInputHash: inputHash(updated) });
          return;
        }
      }
    }
    if (plan.cardKind === 'permission' && mayAuto('rule:') && b && typeof b.auto === 'function') {
      // S-L1: an exact (repo, tool, inputHash) match of a kernel-derived `always` rule ⇒ allow with no card, approval.auto first
      let rule: { ruleId: string } | null = null;
      try {
        // Aegis M2: prefix rules never apply in manual mode (exact rules do); M3: the match is bound to the session roots
        rule = this.#o.alwaysRule?.(repoKey, ev.toolName, plan.inputHash, ev.input, { prefixRules: mode !== 'manual', roots: [s.cwd, ...(s.worktree ? [s.worktree] : [])], editPath: editPass?.ok ? editPass.path : null, repoEdits }) ?? null;
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
    // scoped edits (TD-2026-10-23-939 follow-up): an edit the auto-edits pass would allow offers "Always: this file" and
    // "Always: edits in this repo" (detail.editScopes + editPath inside contentHash); never in a loop session or manual mode
    const offered = editPass?.ok && loopBy === null ? withEditScopes(plan, editPass.path, repoEdits ? EDIT_SCOPE_KINDS : EDIT_SCOPE_KINDS.filter((k) => k !== 'repo-edits')) : plan;
    // ^loop-origin-clamp: a loop session's card carries detail.origin 'loop' and "Raised by loop X (authored by Y)"
    const shown = loopBy !== null ? withLoopOrigin(offered, loopBy) : offered;
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
      const card = await b.raise({ kind: plan.cardKind, requestedBy: s.principalId, hsid: s.hsid, attended: true, detail: shown.detail, lines: shown.lines, block: shown.block, toolInput: ev.input, tool: ev.toolName, decisions: plan.decisions as never, ...ask, ...(plan.cardKind === 'permission' ? { ruleScope: { repoKey } } : {}) });
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
    if (e.cardKind === 'plan' && decision === 'approve-plan') s.planApproved = true; // manual: writes and exec may now raise cards
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
    await this.#gitVerbs?.closeSession(s.hsid).catch(() => undefined);
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

  /**
   * #gnomon-voice V2a kernel-side busy (TD-2026-10-19-298): is the session's model turn streaming now, and when (kernel
   * clock) did the last reply end. Streaming runs from turn.sent until the main-chain reply ENDS (message_stop after an
   * end_turn stop_reason), re-armed by every new main-chain message_start (a Stop-hook continuation); the turn's result
   * ends it only when that end was not seen (voice drops fix 2026-10-20: Claude Code's result can come ~30 s after the
   * reply, which refused every utterance in between as voice-playback). The supervisor's own state, never a client claim.
   */
  turnBusy(hsid: string): { streaming: boolean; endedAt: number | null } {
    const s = this.#sessions.get(hsid);
    if (s) return { streaming: s.state === 'running' && s.turnPermits.length > 0 && s.replyDone !== true, endedAt: s.lastTurnEndAt ?? null };
    return this.#local.turnBusy(hsid);
  }

  /** Voice busy guard: one main-chain stream_event edge (message_start re-arms; end_turn delta + message_stop ends). */
  #replyEdge(s: Session, type: string, stopReason: string | null): void {
    if (type === 'stream_event.message_start') {
      s.replyDone = false;
      s.replyEnding = false;
    } else if (type === 'stream_event.message_delta' && stopReason !== null) {
      s.replyEnding = stopReason === 'end_turn';
    } else if (type === 'stream_event.message_stop' && s.replyEnding) {
      this.#replyEnded(s);
    }
  }

  #replyEnded(s: Session): void {
    s.replyEnding = false;
    if (s.turnPermits.length === 0) return; // no turn in flight (a resumed history line): nothing ends
    s.replyDone = true;
    s.lastTurnEndAt = Date.now();
  }

  /** The owner principal of a live session (Claude or local), or undefined (#gnomon-voice attachment, V1). */
  ownerOf(hsid: string): string | undefined {
    const s = this.#sessions.get(hsid);
    if (s) return s.state === 'running' ? s.owner : undefined;
    return this.#local.ownerOf(hsid);
  }

  /** 8.0:model-switch: a refusal on its MODEL_SWITCH_REASON_ROUTES code. */
  #switchRefusal(reason: keyof typeof MODEL_SWITCH_REASON_ROUTES & string, message: string, data: Record<string, unknown> = {}): RefusedError {
    return refused(MODEL_SWITCH_REASON_ROUTES[reason]!.code, message, { reason, ...data });
  }

  async #modelRow(s: Session, from: string, to: string, permitId: string | null, outcome: SessionModelOutcome): Promise<void> {
    const payload = { hsid: s.hsid, from, to, permitId, outcome };
    const errors = validateKindPayload('session.model', payload);
    if (errors.length) throw new Error(`#supervisor: session.model payload: ${errors.join('; ')}`);
    await this.#o.log('session.model', payload, { session: s.hsid });
  }

  /**
   * 8.0:model-switch, the human's request.session.model{hsid, model}: switch a live Claude session's model in the
   * same process (the conversation continues; the prompt cache restarts). See the header for the order and outcomes.
   */
  async switchModel(principal: string, p: { hsid: string; model: string }, principalClass: string): Promise<{ hsid: string; from: string; to: string; outcome: 'switched'; permitId: string }> {
    if (principalClass !== 'human') throw refused('FORBIDDEN', 'only the human switches a session\'s model', { principalClass });
    if (typeof p?.hsid !== 'string') throw refused('BAD_REQUEST', 'request.session.model needs an hsid', { reason: 'bad-params' });
    const why = claudeModelProblem(p.model);
    if (why !== null) throw refused('BAD_REQUEST', `request.session.model: ${why}`, { reason: 'bad-params', field: 'model' });
    this.#refuseIfDraining('request.session.model');
    if (this.#local.has(p.hsid)) throw this.#switchRefusal('local-session', 'a gnomon-local session has no Claude model to switch');
    const s = this.#get(principal, p.hsid);
    if (s.state !== 'running' || s.child.exitCode !== null || s.child.signalCode !== null) throw refused('NOT_FOUND', 'the session is not running', { reason: 'not-found' });
    if (s.switching) throw this.#switchRefusal('model-switching', 'a model switch of this session is already in flight');
    if (s.turnPermits.length > 0) throw this.#switchRefusal('turn-running', 'a turn is running: switch the model at a turn boundary');
    // Aegis M2: toward ANY 200k target (no `[1m]`), whatever the source model ('opus' may itself run 1M by default)
    const g = MODEL_SWITCH_CONTEXT_GUARD;
    if (!p.model.endsWith(g.fromSuffix)) {
      if (s.contextTokens === null) {
        throw this.#switchRefusal('context-too-large', 'the session\'s context size is not known yet (it was resumed): send one message first, then switch', { contextTokens: null, maxTokens: g.maxTokens });
      }
      if (s.contextTokens > g.maxTokens) {
        throw this.#switchRefusal('context-too-large', `the session uses ${s.contextTokens} tokens of context, more than a 200k model takes (${g.maxTokens}); checkpoint and compact first`, { contextTokens: s.contextTokens, maxTokens: g.maxTokens });
      }
    }
    const from = s.model;
    const to = p.model;
    const requestId = `set-model-${randomUUID()}`;
    s.switching = { requestId, from, to }; // synchronously, before any await: a concurrent switch or send is refused
    let fresh: PermitV1 | null = null;
    try {
      const req = { hsid: s.hsid, model: to };
      const errs = validateKindPayload('request.session.model', req);
      if (errs.length) throw refused('BAD_REQUEST', `request.session.model: ${errs.join('; ')}`, { reason: 'bad-params' });
      await this.#o.log('request.session.model', req, { session: s.hsid });
      // budget re-check: law 7 over the session's layers, then a new spawn permit for the new model (subscription only)
      const hits = law7Scan(s.env, law7Layers(s.layerInput));
      if (hits.length) {
        await this.#o.log('billing.api.refused', { hsid: s.hsid, where: hits.map((h) => h.where), keys: hits.map((h) => h.key) }, { session: s.hsid });
        await this.#modelRow(s, from, to, null, 'permit-refused');
        throw refused('BILLING_REFUSED', 'an API-billing path appeared in a layer this session reads (law 7)', { session: 'api_billing_refused' });
      }
      try {
        fresh = await this.#o.fuse.reserve({ principal: s.owner, principalClass: 'human', attended: true, kind: 'session.spawn', backend: 'claude-code', model: to, scope: { user: s.owner, session: s.hsid }, kernelSpawn: { hsid: s.hsid } });
        this.assertClaudePermit(fresh, s.hsid);
        if (fresh.billing !== 'subscription') throw refused('BILLING_REFUSED', 'a model switch runs on the subscription only (law 7)', { billing: fresh.billing });
      } catch (err) {
        if (fresh) await this.#release(fresh.permitId, s, 'permit-refused');
        fresh = null;
        await this.#modelRow(s, from, to, null, 'permit-refused');
        throw err;
      }
      const permitId = fresh.permitId;
      const line = controlSetModelLine(requestId, to);
      const answer = new Promise<{ subtype: string | null; error: string | null; errorCode: string | null } | null | 'timeout'>((resolve) => {
        const t = setTimeout(() => {
          s.controlWaiters.delete(requestId);
          resolve('timeout');
        }, this.#o.modelSwitchTimeoutMs ?? MODEL_SWITCH_TIMEOUT_MS);
        s.controlWaiters.set(requestId, (r) => {
          clearTimeout(t);
          resolve(r);
        });
      });
      await this.#o.log('session.inject', { hsid: s.hsid, origin: 'kernel', hash: sha(line), bytes: Buffer.byteLength(line, 'utf8'), channel: 'model', requestId, to }, { session: s.hsid });
      if (s.state === 'running' && s.child.exitCode === null && s.child.signalCode === null) this.#stdin(s, line);
      const r = await answer;
      if (r !== null && r !== 'timeout' && r.subtype === 'success') {
        const old = s.spawnPermit;
        s.spawnPermit = fresh;
        s.model = to;
        fresh = null;
        await this.#dropUncertain(s, 'superseded'); // an earlier timed-out switch's held permit is moot now
        await this.#release(old.permitId, s, 'switched');
        await this.#modelRow(s, from, to, permitId, 'switched');
        return { hsid: s.hsid, from, to, outcome: 'switched', permitId };
      }
      if (r !== null && r !== 'timeout') {
        await this.#release(permitId, s, 'backend-refused');
        fresh = null;
        await this.#modelRow(s, from, to, permitId, 'backend-refused');
        throw this.#switchRefusal('model-switch-failed', `claude refused the model${r.error ? `: ${r.error}` : ''}`, { ...(r.errorCode ? { errorCode: r.errorCode } : {}) });
      }
      // timeout: the old model stays on record and the fresh permit is HELD until ground truth reconciles (Aegis M1:
      // claude may already run `to`, so its usage must not land on a released permit). The session exited first ⇒ released.
      if (r === 'timeout' && s.state === 'running') {
        await this.#dropUncertain(s, 'superseded');
        s.modelUncertain = { from, to, baseline: s.seenModel, permit: fresh };
        fresh = null;
      } else {
        await this.#release(permitId, s, 'session-exited');
        fresh = null;
      }
      await this.#modelRow(s, from, to, permitId, 'timeout');
      throw this.#switchRefusal('model-switch-timeout', r === null ? 'the session exited before claude answered the switch' : 'claude did not answer the switch in time; the next reply will show which model runs', { uncertain: r === 'timeout' });
    } finally {
      if (fresh) await this.#release(fresh.permitId, s, 'switch-aborted');
      s.controlWaiters.delete(requestId);
      s.switching = null;
    }
  }

  /**
   * 8.0:model-switch timeout reconcile: a main-chain assistant message's `message.model` is what actually ran. After a
   * timed-out switch it decides the model on record — switched when it differs from the model the stream showed
   * before the switch (with no baseline: when it names the target's family) — and writes session.model{reconciled}.
   */
  async #reconcileModel(s: Session, seen: string): Promise<void> {
    const u = s.modelUncertain;
    s.seenModel = seen;
    if (!u) return;
    s.modelUncertain = null;
    const family = u.to.replace(/\[1m\]$/, '').replace(/^claude-/, '');
    const took = u.baseline !== null ? seen !== u.baseline : seen === u.to || (family !== 'default' && seen.includes(family));
    if (took) {
      // Aegis M1: exactly the success path — the held permit becomes the spawn permit, the old one is released
      const old = s.spawnPermit;
      s.spawnPermit = u.permit;
      s.model = u.to;
      await this.#release(old.permitId, s, 'reconciled');
    } else {
      s.model = u.from;
      await this.#release(u.permit.permitId, s, 'reconciled-old');
    }
    await this.#modelRow(s, u.from, s.model, s.spawnPermit.permitId, 'reconciled');
  }

  /** Release a permit; a failure is logged (Aegis L4), never thrown and never silently swallowed. */
  async #release(permitId: string, s: Session, why: string): Promise<void> {
    try {
      await this.#o.fuse.release(permitId, s.owner);
    } catch (err) {
      this.#o.logger?.component('#session-runner').warn('permit release failed', { hsid: s.hsid, permitId, why, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Release a timed-out switch's held permit and clear the uncertainty (exit, or a later switch supersedes it). */
  async #dropUncertain(s: Session, why: string): Promise<void> {
    const u = s.modelUncertain;
    if (!u) return;
    s.modelUncertain = null;
    await this.#release(u.permit.permitId, s, `uncertain-${why}`);
  }

  async send(principal: string, p: { hsid: string; text: string; permitId?: string; steer?: boolean; source?: 'voice'; voice?: VoiceTurnLink; voiceAttribution?: VoiceAttribution; origin?: 'kernel'; voiceOrigin?: { sentBy: VoiceSentBy } }): Promise<{ turn: string; steered?: boolean }> {
    this.#refuseIfDraining('session.send'); // §2.4 rule 11: no new turn starts once a drain began (Claude and gnomon-local)
    if (this.#local.has(p.hsid)) return this.#local.send(principal, p);
    const s = this.#get(principal, p.hsid);
    // M1.8 slice 2 serves steer on local sessions only; Claude's mid-turn steer is not built (refused, never ignored)
    if (p.steer === true) throw refused('BAD_REQUEST', 'session.send{steer} is served for local sessions only', { reason: 'bad-params' });
    if (s.state !== 'running' || s.child.exitCode !== null || s.child.signalCode !== null) throw refused('NOT_FOUND', 'the session is not running', { reason: 'not-found' });
    if (typeof p.text !== 'string' || p.text.length === 0) throw refused('BAD_REQUEST', 'send takes non-empty text', { reason: 'bad-params' });
    if (s.switching) throw this.#switchRefusal('model-switching', 'the session\'s model is switching: send once the switch answers');
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
    s.replyDone = false; // voice busy guard: a turn sent streams until its reply ends
    s.replyEnding = false;
    const n = ++s.turns;
    s.turnIds.push(turnId(s.hsid, n));
    s.replayLive = true; // re-review L-2: the first turn sent makes the stream live too
    const contentHash = turnContentHash(p.text);
    // origin kernel: a KERNEL-templated turn (#offer-router's open text), never model or client text
    await this.#o.log('session.inject', { hsid: s.hsid, origin: p.origin === 'kernel' ? 'kernel' : 'client', hash: contentHash, bytes: Buffer.byteLength(p.text, 'utf8'), ...voiceTag(p) }, { session: s.hsid });
    // table talk: while voice is attached to this session, EVERY turn carries the guidance as a second text block;
    // contentHash stays the human's text alone (replay binds to it), turn.sent names the guidance by an opaque hash
    // #voice-origin: every turn carries a kernel-stamped origin, for the record only (TD-2026-10-23-939: a voice turn's
    // permissions are a typed turn's); a piece reaches the agent with the piece note on the per-turn guidance block
    // (argv never changes per turn)
    const sentBy = p.voiceOrigin?.sentBy ?? null;
    const book = (s.voicePieces ??= new VoicePieceCounter());
    const base = this.#turnGuidance(s.hsid);
    const guidance = sentBy === 'piece' ? [base, pieceGuidance(book.nextPiece())].filter((x): x is string => x !== null).join('\n\n') : base;
    await this.#o.log('turn.sent', { hsid: s.hsid, turn: turnId(s.hsid, n), permitId: permit.permitId, contentHash, ...voiceTag(p), origin: sentBy === 'unverified' ? 'voice-unverified' : sentBy !== null ? 'voice' : 'hand', ...(sentBy !== null ? { sentBy } : {}), ...(guidance !== null ? { guidanceHash: guidanceHashOf(guidance) } : {}) }, { session: s.hsid });
    book.sent(sentBy);
    this.#stdin(s, userMessageLine(p.text, guidance));
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
    const stop = await this.#stopSession(s, DRAIN_EXIT_REASONS[outcome], 'session-drained'); // F4 also for a request that arrived after the expiry above
    // the drain resolves only after the session's exit path ran (its permit.release rows are on the chain before the
    // daemon shuts down or a successor reads the rows); #onExit drops the session from #sessions and wakes the waiters
    if (stop.exited) await this.#until(() => this.#sessions.get(s.hsid) !== s, DRAIN_EXIT_SETTLE_MS);
    await s.trace?.flush(TRACE_DRAIN_FLUSH_MS); // #trace-capture (Aegis L3): the kernel is about to go away; a hung disk bounds the wait
    return { hsid: s.hsid, uuid: s.uuid, outcome };
  }

  /** #local-runner's daemon-start probe of every configured local endpoint (model.probe / model.capabilities rows). */
  probeLocal(): Promise<Array<{ endpoint: string; ok: boolean }>> {
    return this.#local.probeAll();
  }

  /**
   * TD-2026-10-22-769 (#local-config-request hot apply): the daemon reloaded local.signed.json; new opens (attended and
   * loop steps) use `config` at once, live local sessions keep their spawn-time config. Undefined = no local lane.
   */
  setLocalConfig(config: LocalLaneConfig | undefined): void {
    this.#local.setConfig(config);
  }

  /** status.local's health rows: the last probe, the probe in flight and the last fallback card (Mika's Settings section). */
  localHealth(): { lastProbe: unknown; probing: { endpoint: string; since: string } | null; lastFallback: unknown } {
    return { lastProbe: this.#local.lastProbe(), probing: this.#local.probing(), lastFallback: this.#local.lastFallback() };
  }

  /** The lane's probe state for request.local.probe (a Check again of a configured endpoint refreshes it). */
  localProbeSink(): LocalProbeSink {
    return this.#local;
  }

  /** The local lane config new opens use (undefined = none). */
  localConfig(): LocalLaneConfig | undefined {
    return this.#local.config();
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
      ...[...this.#sessions.values()].map((s) => ({ hsid: s.hsid, principalId: s.principalId, state: s.state, turns: s.turns, permitId: s.spawnPermit.permitId, model: s.model, ...(s.switching ? { modelSwitching: s.switching.to } : {}), ...(s.modelUncertain ? { modelUncertain: true, modelTarget: s.modelUncertain.to } : {}), ...(s.drained ? { drained: s.drained } : {}), ...(s.trace ? { traced: true } : {}) })),
      ...this.#history,
      ...this.#local.status(),
    ];
  }

  /**
   * P8-D87 (Aegis L2): read a session's effective mode and record the transition. Entering `manual` from any other
   * mode drops the approved plan: manual is plan-first from the moment it applies, however briefly the session left it.
   */
  /** Aegis H1: does the strictness ceiling allow auto-edits for this session? An unreadable view never does. */
  #ceilingAllowsAutoEdits(s: Session, repoKey: string): boolean {
    try {
      return this.#o.runMode?.(s.hsid, repoKey)?.ceiling === 'auto-edits';
    } catch {
      return false;
    }
  }

  #modeTransition(s: Session, repoKey: string): RunMode {
    let mode: RunMode = 'ask';
    try {
      mode = this.#o.runMode?.(s.hsid, repoKey)?.effective ?? 'ask';
    } catch {
      mode = 'manual'; // an unreadable mode never loosens anything
    }
    if (mode !== s.lastMode) {
      if (mode === 'manual') s.planApproved = false;
      s.lastMode = mode;
    }
    return mode;
  }

  /**
   * P8-D87 (Aegis L2): a run mode changed (RunModeControl calls this after every applied change). Each live session
   * records its transition NOW, not at its next permission request — so manual → ask → manual between two requests
   * still re-requires a plan.
   */
  noteModeChange(): void {
    for (const s of this.#sessions.values()) {
      if (s.state === 'exited') continue;
      this.#modeTransition(s, repoKeyOf([s.cwd, ...(s.worktree ? [s.worktree] : [])]));
    }
  }

  /** P8-D87: a LIVE Claude session's mode scope (repo key over its roots, cwd); null when unknown or exited. */
  scopeOf(hsid: string): { hsid: string; repoKey: string; cwd: string } | null {
    const s = this.#sessions.get(hsid);
    if (!s || s.state === 'exited') return null;
    return { hsid: s.hsid, repoKey: repoKeyOf([s.cwd, ...(s.worktree ? [s.worktree] : [])]), cwd: s.cwd };
  }

  /** Aegis M1 (#paradigm-context-mod K3): the session principal of a LIVE session, or null. */
  principalOf(hsid: string): string | null {
    const s = this.#sessions.get(hsid);
    return s && s.state !== 'exited' ? s.principalId : null;
  }

  /**
   * #loop-land (step 11, Aegis L7): every live human session, Claude and local attended (loop sessions excluded), its
   * cwd and whether a turn is in flight now (the supervisor's own streaming state, never a client claim).
   */
  humanTurns(): Array<{ cwd: string; busy: boolean }> {
    return [...this.liveScopes().map((x) => ({ cwd: x.cwd, busy: this.turnBusy(x.hsid).streaming })), ...this.#local.humanTurns().map((x) => ({ cwd: x.cwd, busy: x.busy }))];
  }

  /** P8-D87: every live Claude session's mode scope (status.runModes). */
  liveScopes(): Array<{ hsid: string; repoKey: string; cwd: string }> {
    return [...this.#sessions.keys()].map((h) => this.scopeOf(h)).filter((x): x is { hsid: string; repoKey: string; cwd: string } => x !== null);
  }

  /** model picker: the Claude model a live Claude session runs now ('claude' = Claude Code's default), or null. */
  modelOf(hsid: string): string | null {
    return this.#sessions.get(hsid)?.model ?? null;
  }

  /** One session's state (tests, status): running | stopping | exited | null. */
  stateOf(hsid: string): string | null {
    return this.#sessions.get(hsid)?.state ?? (this.#history.some((h) => h.hsid === hsid) ? 'exited' : this.#local.stateOf(hsid));
  }
}
