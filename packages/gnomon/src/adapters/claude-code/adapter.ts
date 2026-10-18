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
 *     <mcp.json> --strict-mcp-config`, optional system prompt and model.
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
 *     policy.json (`--settings`); unapproved, denied or unsafe hooks never run;
 *   - `all` (the slice-1 behaviour): user, project, local — your hooks AND
 *     any hooks committed in the repo's `.claude/settings.json`, raw;
 *   - `user-only`: user — your own hooks, never the repo's;
 *   - `none`: no layer — only Gnomon's generated policy.json applies.
 * Managed settings load regardless (p01: outside the switch).
 */
export const SESSION_HOOKS_MODES = Object.freeze(['audited', 'all', 'user-only', 'none'] as const);
export type SessionHooksMode = (typeof SESSION_HOOKS_MODES)[number];
export const DEFAULT_SESSION_HOOKS: SessionHooksMode = 'audited';

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

export function buildClaudeArgv(i: ClaudeArgvInput): string[] {
  for (const s of i.settingSources) if (!(SETTING_SOURCES as readonly string[]).includes(s)) throw new TypeError(`#claude-adapter: unknown setting source ${String(s)}`);
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
    ...(i.appendSystemPrompt !== undefined ? ['--append-system-prompt', i.appendSystemPrompt] : []),
    ...(i.model !== undefined ? ['--model', i.model] : []),
    ...(i.extra ?? []),
  ];
  assertNoForbiddenFlags(argv);
  assertPermissionChannel(argv);
  return argv;
}

/* ── stdin lines ─────────────────────────────────────────────────────────── */

export function userMessageLine(text: string): string {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`;
}

export function controlInterruptLine(requestId: string = randomUUID()): string {
  return `${JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype: 'interrupt' } })}\n`;
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
  | { kind: 'partial'; type: string; bytes: number; usage?: { messageId: string | null; tokens: number } }
  | { kind: 'message'; type: string; messageId: string | null; tokens: number | null; toolUses: Array<{ id: string | null; name: string; input: unknown }>; quota: boolean }
  | { kind: 'user'; type: string; replay: boolean }
  | { kind: 'result'; type: string; subtype: string | null; isError: boolean; tokens: number | null; costUsd: number | null; permissionDenials: number; quota: boolean }
  | { kind: 'control'; type: string; subtype: string | null; requestId: string | null }
  | { kind: 'permission-request'; type: 'control_request.can_use_tool'; requestId: string; toolName: string; toolUseId: string | null; input: Record<string, unknown> }
  | { kind: 'control-cancel'; type: 'control_cancel_request'; requestId: string }
  | { kind: 'permission-malformed'; type: 'control_request.can_use_tool'; requestId: string }
  | { kind: 'control-request-unknown'; type: string; subtype: string; requestId: string | null }
  | { kind: 'unknown'; type: string }
  | { kind: 'malformed'; type: string; bytes: number };

/** A control request id we answer: printable, bounded (p01b: Claude sends UUIDs). */
export const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

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
      return { kind: 'partial', type: `stream_event.${evType}`, bytes: Buffer.byteLength(line), ...(u !== null && id !== null ? { usage: { messageId: id, tokens: u } } : {}) };
    }
    case 'assistant': {
      const m = obj(o.message);
      const content = Array.isArray(m?.content) ? (m!.content as unknown[]) : [];
      const toolUses = content.map(obj).filter((c): c is Record<string, unknown> => c !== null && c.type === 'tool_use').map((c) => ({ id: str(c.id), name: str(c.name) ?? '', input: c.input }));
      const quota = str(o.error) !== null && QUOTA.test(String(o.error));
      return { kind: 'message', type: 'assistant', messageId: str(m?.id), tokens: usageTokens(m?.usage), toolUses, quota };
    }
    case 'user':
      return { kind: 'user', type: 'user', replay: o.isReplay === true };
    case 'result': {
      const isError = o.is_error === true;
      const text = `${str(o.subtype) ?? ''} ${str(o.result) ?? ''} ${String(o.api_error_status ?? '')}`;
      return {
        kind: 'result',
        type: 'result',
        subtype: str(o.subtype),
        isError,
        tokens: usageTokens(o.usage),
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
      return { kind: 'control', type: 'control_response', subtype: str(r?.subtype), requestId: str(r?.request_id) };
    }
    default:
      return { kind: 'unknown', type };
  }
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
