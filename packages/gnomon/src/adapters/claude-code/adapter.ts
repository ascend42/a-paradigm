/**
 * @symbol #claude-adapter
 *
 * #claude-adapter (spec §2.2 `#backend-adapter` interface, §3.3 argv +
 * Process; M1.7) — the ONE place that knows the shape of `claude -p`'s
 * stream-json (it is not a published contract, §2.2).
 *
 *   buildClaudeArgv — the §3.3 argv: `-p`, stream-json in and out, verbose,
 *     replayed user messages, partial messages, `--permission-mode default`,
 *     `--permission-prompts host --permission-prompt-tool stdio` (P8-D96: the
 *     tool-permission channel; probe p01b found `host` ALONE delivers no
 *     request, and `none` wins over `stdio`; any other value or a second copy
 *     throws), `--session-id|--resume <uuid>`,
 *     `--settings <policy.json>`, an EXPLICIT `--setting-sources`, `--mcp-config
 *     <mcp.json> --strict-mcp-config`, optional system prompt and model (the model
 *     must pass claudeModelProblem: an alias or a strict `claude-…` id, never a
 *     value starting with `-`).
 *     FORBIDDEN_FLAGS throw (`agents.ts:40,456`), checked on the final argv
 *     including caller-supplied extras (G-RUN-01).
 *   parseStreamLine — one stdout line → one typed AdapterEvent. TOLERANT
 *     (falsifier "> 1 stream-json breaking change/month"): unknown fields are
 *     ignored, an unknown `type` is `{kind:'unknown'}` (logged, never acted
 *     on), a line that is not a JSON object is `{kind:'malformed'}`. Usage is
 *     read only from `assistant.message.usage`, `stream_event` message deltas
 *     and `result.usage` — never from model text (§2.2, 10 §1).
 *   UsageMeter — per turn: an assistant message's usage is cumulative and
 *     repeated once per content block, so each message id is charged its
 *     DELTA; `result.usage` charges only what the messages did not (no double
 *     count). Tokens = input + output + cache creation + cache read.
 *   controlInterrupt / userMessage — the stdin lines: interrupt is the
 *     stream-json `control_request{subtype:'interrupt'}` on every OS, never a
 *     signal (A23-4).
 *   controlSetModelLine — the mid-session model switch (probe p-set-model,
 *     claude 2.1.304): `control_request{subtype:'set_model', model}`; claude
 *     answers `control_response{subtype:'success'|'error', request_id, error?,
 *     error_code?}` (an unknown model is `error` / `catalog_unknown`), parsed
 *     as `{kind:'control', subtype, requestId, error, errorCode}`. An assistant
 *     message carries `message.model` (the model that actually ran: the
 *     switch's ground truth) and `parent_tool_use_id` (non-null: a subagent's
 *     message, not the main chain's context).
 *   P8-D96 permission channel (shapes measured by probe p01b, claude 2.1.302):
 *     stdout `control_request{request_id, request:{subtype:'can_use_tool',
 *     tool_name, input, tool_use_id, …}}` ⇒ `permission-request`;
 *     `control_cancel_request{request_id}` ⇒ `control-cancel`; any other
 *     control_request subtype ⇒ `control-request-unknown`. A can_use_tool line
 *     with a valid request id but a bad body is `permission-malformed`
 *     (answered deny); one with a bad id is `malformed` (cannot be answered;
 *     the supervisor logs approval.suspect). stdin answers:
 *     permissionAllowLine / permissionDenyLine / controlErrorLine. None of them
 *     ever carries `updatedPermissions`, and Claude's `permission_suggestions`
 *     are never read: every rule lives in the kernel log.
 */
import { randomUUID } from 'node:crypto';
import { claudeModelProblem, sanitizeDisplayText } from '@a-company/gnomon-contracts';

export const FORBIDDEN_FLAGS = Object.freeze(['--dangerously-skip-permissions', '--allowedTools', '--allowed-tools', '--bare']);
export const SETTING_SOURCES = Object.freeze(['user', 'project', 'local'] as const);
export type SettingSource = (typeof SETTING_SOURCES)[number];

/**
 * "Your hooks inside sessions" (founder decision OPEN, T-2026-10-18-010 L4;
 * docs/private/gnomon-founder-steps.html): which Claude settings layers a
 * Gnomon-started session loads — and so whose hooks run inside it, with no
 * trust prompt in `-p` mode. A ROOT-SIGNED config switch
 * (`config.sessions.hooks`, budget/config.ts), never env/project/CLI:
 *   - `audited` (DEFAULT, founder ruling P8-D94): user only, plus the repo's
 *     project/local hooks the KERNEL extracted and the human approved per
 *     hook (kernel/supervisor/repo-hooks.ts), written into the session's own
 *     policy.json (`--settings`); unapproved, denied or unsafe hooks never run.
 *     P8-D97: the repo's CONTEXT still loads — `--add-dir` memory dirs (with
 *     REPO_CONTEXT_ENV) and a kernel-staged `--plugin-dir` of its skills,
 *     agents and commands with frontmatter hooks stripped
 *     (kernel/supervisor/repo-context.ts; probe p10m-repo-context);
 *   - `all` (the slice-1 behaviour): user, project, local — your hooks AND
 *     any hooks committed in the repo's `.claude/settings.json`, raw;
 *   - `user-only`: user — your own hooks, never the repo's;
 *   - `none`: no layer — only Gnomon's generated policy.json applies.
 * Managed settings load regardless (p01: outside the switch).
 */
export const SESSION_HOOKS_MODES = Object.freeze(['audited', 'all', 'user-only', 'none'] as const);
export type SessionHooksMode = (typeof SESSION_HOOKS_MODES)[number];
export const DEFAULT_SESSION_HOOKS: SessionHooksMode = 'audited';

/** P8-D97: only `audited` loads the repo's context through the kernel (`all` loads it natively; the others not at all). */
export function repoContextFor(mode: SessionHooksMode): boolean {
  return mode === 'audited';
}

export function settingSourcesFor(mode: SessionHooksMode): readonly SettingSource[] {
  switch (mode) {
    case 'all':
      return ['user', 'project', 'local'];
    case 'audited': // the repo layers reach Claude only through the kernel's audited extract (P8-D94)
    case 'user-only':
      return ['user'];
    case 'none':
      return [];
    default:
      throw new TypeError(`#claude-adapter: unknown session hooks mode ${String(mode)}`);
  }
}

/** P8-D96: the only permission-channel values (p01b: `host` needs `--permission-prompt-tool stdio`). */
export const PERMISSION_PROMPTS = 'host' as const;
export const PERMISSION_PROMPT_TOOL = 'stdio' as const;

/** Exactly one `--permission-prompts host` and one `--permission-prompt-tool stdio` (also in `--flag=value` form); anything else throws. */
export function assertPermissionChannel(argv: readonly string[]): void {
  for (const [flag, want] of [['--permission-prompts', PERMISSION_PROMPTS], ['--permission-prompt-tool', PERMISSION_PROMPT_TOOL]] as const) {
    const values: string[] = [];
    argv.forEach((a, i) => {
      if (a === flag) values.push(argv[i + 1] ?? '');
      else if (a.startsWith(`${flag}=`)) values.push(a.slice(flag.length + 1));
    });
    if (values.length !== 1 || values[0] !== want) throw new TypeError(`#claude-adapter: ${flag} must appear once as ${want} (P8-D96), got ${JSON.stringify(values)}`);
  }
}

export class ForbiddenFlagError extends Error {
  readonly flag: string;
  constructor(flag: string) {
    super(`#claude-adapter: forbidden flag ${flag} (§3.3 FORBIDDEN_FLAGS)`);
    this.flag = flag;
  }
}

export interface ClaudeArgvInput {
  /** `--session-id` for a new session, `--resume` for a respawn. */
  uuid: string;
  resume?: boolean;
  policyPath: string;
  mcpConfigPath: string;
  /** Explicit subset (p01: user, project, local); empty = none. */
  settingSources: readonly SettingSource[];
  appendSystemPrompt?: string;
  model?: string;
  /** P8-D97: kernel-staged plugin dirs (`--plugin-dir`, each once) — the repo's stripped skills, agents, commands. */
  pluginDirs?: readonly string[];
  /** P8-D97: memory dirs (`--add-dir`, each once) — loaded as CLAUDE.md dirs with REPO_CONTEXT_ENV. */
  addDirs?: readonly string[];
  /** Extra flags (never a forbidden one). */
  extra?: readonly string[];
}

/** Throws ForbiddenFlagError for any forbidden flag, also in `--flag=value` form. */
export function assertNoForbiddenFlags(argv: readonly string[]): void {
  for (const a of argv) {
    const flag = a.split('=')[0]!;
    if (FORBIDDEN_FLAGS.includes(flag)) throw new ForbiddenFlagError(flag);
  }
}

/** Q6 (Aegis): the ONLY flags a caller may pass in `extra`, with their arity. Every other flag is refused. */
export const EXTRA_FLAGS: Readonly<Record<string, 0 | 1>> = Object.freeze({ '--max-turns': 1, '--no-session-persistence': 0 });

type FlagSpec = { arity: 0 | 1 | '*'; min: number; max: number };
/**
 * Q6: the whole argv grammar. Every kernel-owned flag appears exactly once (min = max = 1) or at most once; `--agents`
 * and `--tools` are kernel-owned and the kernel never sets them, so they may not appear at all. `--session-id` and
 * `--resume` are exactly one between them. `--add-dir` is ONE variadic flag.
 */
export const ARGV_GRAMMAR: Readonly<Record<string, FlagSpec>> = Object.freeze({
  '-p': { arity: 0, min: 1, max: 1 },
  '--input-format': { arity: 1, min: 1, max: 1 },
  '--output-format': { arity: 1, min: 1, max: 1 },
  '--verbose': { arity: 0, min: 1, max: 1 },
  '--replay-user-messages': { arity: 0, min: 1, max: 1 },
  '--include-partial-messages': { arity: 0, min: 1, max: 1 },
  '--permission-mode': { arity: 1, min: 1, max: 1 },
  '--permission-prompts': { arity: 1, min: 1, max: 1 },
  '--permission-prompt-tool': { arity: 1, min: 1, max: 1 },
  '--session-id': { arity: 1, min: 0, max: 1 },
  '--resume': { arity: 1, min: 0, max: 1 },
  '--settings': { arity: 1, min: 1, max: 1 },
  '--setting-sources': { arity: 1, min: 1, max: 1 },
  '--mcp-config': { arity: 1, min: 1, max: 1 },
  '--strict-mcp-config': { arity: 0, min: 1, max: 1 },
  '--plugin-dir': { arity: 1, min: 0, max: 1 },
  '--add-dir': { arity: '*', min: 0, max: 1 },
  '--append-system-prompt': { arity: 1, min: 0, max: 1 },
  '--model': { arity: 1, min: 0, max: 1 },
  '--agents': { arity: 1, min: 0, max: 0 },
  '--tools': { arity: 1, min: 0, max: 0 },
  '--max-turns': { arity: 1, min: 0, max: 1 },
  '--no-session-persistence': { arity: 0, min: 0, max: 1 },
});

/** Q6: walk an argv against a grammar (arity-aware, `--flag=value` included); throws TypeError on any unknown flag, stray value or wrong count. */
export function assertArgv(argv: readonly string[], grammar: Readonly<Record<string, FlagSpec>> = ARGV_GRAMMAR, enforceMin = true): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    const eq = tok.startsWith('--') ? tok.indexOf('=') : -1;
    const name = eq > 0 ? tok.slice(0, eq) : tok;
    const spec = grammar[name];
    if (!spec) throw new TypeError(`#claude-adapter: ${tok.startsWith('-') ? `flag ${name} is not allowed here` : `stray argument ${JSON.stringify(tok.slice(0, 64))}`} (Q6)`);
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (spec.arity === 0) {
      if (eq > 0) throw new TypeError(`#claude-adapter: ${name} takes no value (Q6)`);
    } else if (spec.arity === 1) {
      if (eq < 0) {
        if (i + 1 >= argv.length) throw new TypeError(`#claude-adapter: ${name} needs a value (Q6)`);
        i++;
      }
    } else {
      let n = eq > 0 ? 1 : 0;
      while (i + 1 < argv.length && !argv[i + 1]!.startsWith('-')) {
        i++;
        n++;
      }
      if (n === 0) throw new TypeError(`#claude-adapter: ${name} needs at least one value (Q6)`);
    }
  }
  for (const [name, spec] of Object.entries(grammar)) {
    const n = counts.get(name) ?? 0;
    if (n > spec.max || (enforceMin && n < spec.min)) throw new TypeError(`#claude-adapter: ${name} must appear ${spec.min === spec.max ? `exactly ${spec.min}` : `at most ${spec.max}`} time(s), got ${n} (Q6)`);
  }
  if (enforceMin && (counts.get('--session-id') ?? 0) + (counts.get('--resume') ?? 0) !== 1) throw new TypeError('#claude-adapter: exactly one of --session-id / --resume (Q6)');
  return counts;
}

export function buildClaudeArgv(i: ClaudeArgvInput): string[] {
  // Q6: extras are an ALLOW-list (a forbidden flag still throws ForbiddenFlagError first)
  assertNoForbiddenFlags(i.extra ?? []);
  assertArgv(i.extra ?? [], Object.fromEntries(Object.entries(EXTRA_FLAGS).map(([k, a]) => [k, { arity: a, min: 0, max: 1 }])), false);
  for (const d of [...(i.pluginDirs ?? []), ...(i.addDirs ?? [])]) if (typeof d !== 'string' || !(d.startsWith('/') || /^[A-Za-z]:[\\/]/.test(d) || d.startsWith('\\\\'))) throw new TypeError(`#claude-adapter: a context dir must be absolute, got ${JSON.stringify(String(d).slice(0, 64))}`);
  for (const s of i.settingSources) if (!(SETTING_SOURCES as readonly string[]).includes(s)) throw new TypeError(`#claude-adapter: unknown setting source ${String(s)}`);
  // model picker (Aegis): `--model` takes the NEXT token whatever it is, so a value like `--verbose` would be eaten as
  // the model and a flag-looking value could reach claude's parser. Only an allow-listed alias or a strict id passes.
  if (i.model !== undefined) {
    const why = claudeModelProblem(i.model);
    if (why !== null) throw new TypeError(`#claude-adapter: --model refused: ${why}`);
  }
  const argv = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--replay-user-messages',
    '--include-partial-messages',
    '--permission-mode', 'default',
    '--permission-prompts', PERMISSION_PROMPTS,
    '--permission-prompt-tool', PERMISSION_PROMPT_TOOL,
    i.resume ? '--resume' : '--session-id', i.uuid,
    '--settings', i.policyPath,
    '--setting-sources', i.settingSources.join(','),
    '--mcp-config', i.mcpConfigPath,
    '--strict-mcp-config',
    ...[...new Set(i.pluginDirs ?? [])].flatMap((d) => ['--plugin-dir', d]),
    ...(i.addDirs?.length ? ['--add-dir', ...new Set(i.addDirs)] : []), // ONE variadic flag (Q6)
    ...(i.appendSystemPrompt !== undefined ? ['--append-system-prompt', i.appendSystemPrompt] : []),
    ...(i.model !== undefined ? ['--model', i.model] : []),
    ...(i.extra ?? []),
  ];
  assertNoForbiddenFlags(argv);
  assertPermissionChannel(argv);
  assertArgv(argv);
  return argv;
}

/* ── stdin lines ─────────────────────────────────────────────────────────── */

/**
 * The user message for one turn. `guidance` (#gnomon-voice table talk, TD-2026-10-20-294) rides as a SECOND text
 * block after the human's text; the first block is always the human's text alone (its bytes are the contentHash).
 */
export function userMessageLine(text: string, guidance?: string | null): string {
  const content = [{ type: 'text', text }, ...(typeof guidance === 'string' && guidance.length > 0 ? [{ type: 'text', text: guidance }] : [])];
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
}

export function controlInterruptLine(requestId: string = randomUUID()): string {
  return `${JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype: 'interrupt' } })}\n`;
}

/**
 * The mid-session model switch (probe p-set-model). The model must pass claudeModelProblem (an alias or a strict
 * `claude-…` id); the request id must be a REQUEST_ID (the kernel matches the control_response by it).
 */
export function controlSetModelLine(requestId: string, model: string): string {
  if (!REQUEST_ID.test(requestId)) throw new TypeError('#claude-adapter: set_model needs a printable request id');
  const why = claudeModelProblem(model);
  if (why !== null) throw new TypeError(`#claude-adapter: set_model refused: ${why}`);
  return `${JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype: 'set_model', model } })}\n`;
}

/** P8-D96 allow: `updatedInput` is ALWAYS the kernel-held input of the request (never a client's); no updatedPermissions. */
export function permissionAllowLine(requestId: string, updatedInput: unknown): string {
  return `${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { behavior: 'allow', updatedInput } } })}\n`;
}

export function permissionDenyLine(requestId: string, message: string, interrupt?: boolean): string {
  return `${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { behavior: 'deny', message, ...(interrupt === true ? { interrupt: true } : {}) } } })}\n`;
}

/** The answer to a control_request subtype the kernel does not serve. */
export function controlErrorLine(requestId: string, error: string): string {
  return `${JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error } })}\n`;
}

/* ── stdout events ───────────────────────────────────────────────────────── */

export interface Usage {
  tokens: number;
}

export type AdapterEvent =
  | { kind: 'init'; type: string; sessionId: string | null; model: string | null; apiKeySource: string | null }
  /**
   * A stream_event line. parentToolUseId: null on the main chain (a sub-agent's stream sets it). stopReason: the
   * message_delta's stop_reason when this line carries one (the #gnomon-voice busy guard ends a reply at the main-chain
   * message_stop after an end_turn delta, TD-2026-10-20 voice drops fix).
   */
  | { kind: 'partial'; type: string; bytes: number; usage?: { messageId: string | null; tokens: number }; parentToolUseId: string | null; stopReason: string | null }
  | { kind: 'message'; type: string; messageId: string | null; tokens: number | null; toolUses: Array<{ id: string | null; name: string; input: unknown }>; quota: boolean; model: string | null; parentToolUseId: string | null; stopReason: string | null }
  | { kind: 'user'; type: string; replay: boolean; toolResults: ToolResultSeen[] }
  | { kind: 'result'; type: string; subtype: string | null; isError: boolean; tokens: number | null; split: UsageSplit | null; costUsd: number | null; permissionDenials: number; quota: boolean }
  | { kind: 'control'; type: string; subtype: string | null; requestId: string | null; error: string | null; errorCode: string | null }
  | { kind: 'permission-request'; type: 'control_request.can_use_tool'; requestId: string; toolName: string; toolUseId: string | null; input: Record<string, unknown> }
  | { kind: 'control-cancel'; type: 'control_cancel_request'; requestId: string }
  | { kind: 'permission-malformed'; type: 'control_request.can_use_tool'; requestId: string }
  | { kind: 'control-request-unknown'; type: string; subtype: string; requestId: string | null }
  | { kind: 'unknown'; type: string }
  | { kind: 'malformed'; type: string; bytes: number };

/** One tool_result in a `user` line: its tool_use id, is_error, and Claude's permission decision (`accept` | `reject`) when reported. */
export interface ToolResultSeen {
  toolUseId: string;
  isError: boolean;
  decision: string | null;
}

/** A control request id we answer: printable, bounded (p01b: Claude sends UUIDs). */
export const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** The turn's usage by kind (#ledger-mod): numbers only, from result.usage. */
export interface UsageSplit {
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
}

/** input / output / cache read / cache creation; null when no usage object. */
export function usageSplit(u: unknown): UsageSplit | null {
  const o = obj(u);
  if (!o) return null;
  // Aegis L2: floored and clamped at the source, so the logged row is exactly what the feed projects
  const int = (v: unknown): number => Math.min(Math.floor(num(v)), Number.MAX_SAFE_INTEGER);
  return { in: int(o.input_tokens), out: int(o.output_tokens), cacheRead: int(o.cache_read_input_tokens), cacheWrite: int(o.cache_creation_input_tokens) };
}

/** input + output + cache creation + cache read; null when no usage object. */
export function usageTokens(u: unknown): number | null {
  const o = obj(u);
  if (!o) return null;
  return num(o.input_tokens) + num(o.output_tokens) + num(o.cache_creation_input_tokens) + num(o.cache_read_input_tokens);
}

const QUOTA = /usage limit|rate[ _-]?limit|quota|429|overloaded/i;

export function parseStreamLine(line: string): AdapterEvent {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return { kind: 'malformed', type: 'malformed', bytes: Buffer.byteLength(line) };
  }
  const o = obj(v);
  if (!o) return { kind: 'malformed', type: 'malformed', bytes: Buffer.byteLength(line) };
  const type = str(o.type) ?? '(none)';
  switch (type) {
    case 'system':
      if (o.subtype === 'init') return { kind: 'init', type: 'system.init', sessionId: str(o.session_id), model: str(o.model), apiKeySource: str(o.apiKeySource) };
      return { kind: 'unknown', type: `system.${str(o.subtype) ?? '(none)'}` };
    case 'stream_event': {
      const ev = obj(o.event);
      const evType = str(ev?.type) ?? '(none)';
      // only message_start carries a message id with its usage; message_delta's id-less usage is never charged
      // (the assistant message repeats it under the id), so nothing is counted twice
      const msg = obj(ev?.message);
      const u = usageTokens(msg?.usage);
      const id = str(msg?.id);
      const delta = obj(ev?.delta);
      const stopReason = evType === 'message_delta' ? str(delta?.stop_reason) : null;
      return { kind: 'partial', type: `stream_event.${evType}`, bytes: Buffer.byteLength(line), ...(u !== null && id !== null ? { usage: { messageId: id, tokens: u } } : {}), parentToolUseId: str(o.parent_tool_use_id), stopReason };
    }
    case 'assistant': {
      const m = obj(o.message);
      const content = Array.isArray(m?.content) ? (m!.content as unknown[]) : [];
      const toolUses = content.map(obj).filter((c): c is Record<string, unknown> => c !== null && c.type === 'tool_use').map((c) => ({ id: str(c.id), name: str(c.name) ?? '', input: c.input }));
      const quota = str(o.error) !== null && QUOTA.test(String(o.error));
      return { kind: 'message', type: 'assistant', messageId: str(m?.id), tokens: usageTokens(m?.usage), toolUses, quota, model: str(m?.model), parentToolUseId: str(o.parent_tool_use_id), stopReason: str(m?.stop_reason) };
    }
    case 'user': {
      // Aegis detector (P8-D96): the tool_result ids, with Claude's own permission decision when it reports one
      const m = obj(o.message);
      const content = Array.isArray(m?.content) ? (m!.content as unknown[]) : [];
      const metas = Array.isArray(o.tool_result_meta) ? (o.tool_result_meta as unknown[]).map(obj) : [];
      const toolResults = content.map(obj).filter((c): c is Record<string, unknown> => c !== null && c.type === 'tool_result' && typeof c.tool_use_id === 'string').map((c) => {
        const meta = metas.find((x) => x !== null && x.id === c.tool_use_id);
        return { toolUseId: c.tool_use_id as string, isError: c.is_error === true, decision: str(obj(meta?.permission_decision)?.decision) };
      });
      return { kind: 'user', type: 'user', replay: o.isReplay === true, toolResults };
    }
    case 'result': {
      const isError = o.is_error === true;
      const text = `${str(o.subtype) ?? ''} ${str(o.result) ?? ''} ${String(o.api_error_status ?? '')}`;
      return {
        kind: 'result',
        type: 'result',
        subtype: str(o.subtype),
        isError,
        tokens: usageTokens(o.usage),
        split: usageSplit(o.usage),
        costUsd: typeof o.total_cost_usd === 'number' && Number.isFinite(o.total_cost_usd) && o.total_cost_usd >= 0 ? o.total_cost_usd : null,
        permissionDenials: Array.isArray(o.permission_denials) ? o.permission_denials.length : 0,
        quota: isError && QUOTA.test(text),
      };
    }
    case 'control_request': {
      const r = obj(o.request);
      const subtype = str(r?.subtype) ?? '(none)';
      const requestId = str(o.request_id);
      if (subtype === 'can_use_tool') {
        const input = obj(r?.input);
        const toolName = str(r?.tool_name);
        const toolUseId = r?.tool_use_id === undefined ? null : str(r?.tool_use_id);
        // Aegis A5: a bad request id cannot be answered (`malformed`); a good id with a bad body is answered deny
        if (requestId === null || !REQUEST_ID.test(requestId)) return { kind: 'malformed', type: 'control_request.can_use_tool', bytes: Buffer.byteLength(line) };
        if (toolName === null || toolName === '' || toolName.length > 256 || input === null || (r?.tool_use_id !== undefined && toolUseId === null)) {
          return { kind: 'permission-malformed', type: 'control_request.can_use_tool', requestId };
        }
        return { kind: 'permission-request', type: 'control_request.can_use_tool', requestId, toolName, toolUseId, input };
      }
      return { kind: 'control-request-unknown', type: `control_request.${subtype}`, subtype, requestId: requestId !== null && REQUEST_ID.test(requestId) ? requestId : null };
    }
    case 'control_cancel_request': {
      const requestId = str(o.request_id);
      if (requestId === null || !REQUEST_ID.test(requestId)) return { kind: 'malformed', type: 'control_cancel_request', bytes: Buffer.byteLength(line) };
      return { kind: 'control-cancel', type: 'control_cancel_request', requestId };
    }
    case 'control_response': {
      const r = obj(o.response);
      // set_model's answer: the error text and claude's error code, when it refused. Aegis L3: the text reaches a
      // refusal message the GUI shows, so it goes through the contracts display sanitiser (control and hidden
      // characters dropped, bidi controls made visible) and onto one line, then bounded
      const error = str(r?.error);
      const code = str(r?.error_code);
      return { kind: 'control', type: 'control_response', subtype: str(r?.subtype), requestId: str(r?.request_id), error: error === null ? null : controlErrorText(error), errorCode: code === null ? null : controlErrorText(code, 64) };
    }
    default:
      return { kind: 'unknown', type };
  }
}

/** A control_response error made safe to show: sanitised (§4.5), one line, at most 256 characters. */
export function controlErrorText(raw: string, max = 256): string {
  // code points, so a cut never splits a surrogate pair
  return Array.from(sanitizeDisplayText(Array.from(raw).slice(0, 4 * max).join('')).text.replace(/[\n\t]+/g, ' ')).slice(0, max).join('');
}

/** The two tool uses that become cards (§3.3): AskUserQuestion ⇒ ask-user, ExitPlanMode ⇒ plan. */
export function cardKindOfTool(name: string): 'ask-user' | 'plan' | null {
  return name === 'AskUserQuestion' ? 'ask-user' : name === 'ExitPlanMode' ? 'plan' : null;
}

/** Per-turn usage deltas (no double count across repeated message usage and the result total). */
export class UsageMeter {
  readonly #byMessage = new Map<string, number>();
  #anon = 0;
  #turn = 0;

  /** A message's cumulative usage; returns the tokens not yet charged. */
  message(messageId: string | null, tokens: number): number {
    if (messageId === null) {
      this.#anon += tokens;
      this.#turn += tokens;
      return tokens;
    }
    const prev = this.#byMessage.get(messageId) ?? 0;
    const delta = Math.max(0, tokens - prev);
    this.#byMessage.set(messageId, Math.max(prev, tokens));
    this.#turn += delta;
    return delta;
  }

  /** The turn's total from `result.usage`; returns what the messages did not charge, and resets the turn. */
  result(total: number | null): number {
    const delta = total === null ? 0 : Math.max(0, total - this.#turn);
    this.#byMessage.clear();
    this.#anon = 0;
    this.#turn = 0;
    return delta;
  }
}

/**
 * Line splitter with the §3.3 caps: a stdout line over `maxLine` bytes is
 * dropped and reported ONCE (with its total size, at its end), never buffered
 * without bound. Linear: each chunk is measured once (no re-measuring of the
 * accumulated buffer).
 */
export class LineSplitter {
  #parts: string[] = [];
  #bytes = 0;
  #dropping = false;
  readonly #maxLine: number;
  constructor(maxLine: number) {
    this.#maxLine = maxLine;
  }
  push(chunk: string, onLine: (line: string) => void, onDropped: (bytes: number) => void): void {
    const segs = chunk.split('\n');
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!;
      const segBytes = Buffer.byteLength(seg);
      this.#bytes += segBytes;
      if (!this.#dropping) {
        if (this.#bytes > this.#maxLine) {
          this.#dropping = true;
          this.#parts = [];
        } else this.#parts.push(seg);
      }
      if (i === segs.length - 1) break; // no newline yet: the line continues in the next chunk
      if (this.#dropping) onDropped(this.#bytes);
      else {
        const line = this.#parts.join('');
        if (line.trim()) onLine(line);
      }
      this.#parts = [];
      this.#bytes = 0;
      this.#dropping = false;
    }
  }
}
