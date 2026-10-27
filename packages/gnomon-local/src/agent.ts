/**
 * @symbol #gnomon-local
 *
 * The agent loop (spec §13.1; pi-agent-core's shape, re-derived): a prompt
 * runs turns until the model stops calling tools or `maxSteps` is reached;
 * the tool calls of one turn run IN PARALLEL; `steer` text is queued and
 * injected at the next step (after the current turn's tools), `follow_up`
 * text waits until the agent ends and then starts a new run; `abort` cancels
 * the in-flight request. Native tool calls are used only when the kernel's
 * probe detected them (capabilities.tools); otherwise the TEXT-TOOL fallback
 * describes the tools in the system prompt and parses `<tool_call>` blocks.
 * Every call's arguments go through the repair ladder; a repaired call emits
 * `model_repair` (the kernel logs model.repair{argument}).
 *
 * Compaction (slice 2, compaction.ts): before a request whose history plus
 * reply budget exceeds `contextTarget` (~8k) the history is compacted under
 * the fixed headings; a request the endpoint refuses as too long is
 * compacted and retried ONCE. Each emits `compaction_start{reason,
 * tokensBefore}` / `compaction_end{reason, tokensBefore, tokensAfter, kept,
 * usage}` (or `{error}`); the summariser's usage is part of agent_end's
 * total (the kernel charges it as the run's remainder — tracked, never lost).
 *
 * T-2026-10-26-003 (local lane fixes):
 *   - read_file pages are capped at a quarter of the working budget
 *     (budget/4 tokens ≈ budget bytes at 4 chars a token: ctx.readCap),
 *     split across the read_file calls of one turn, never above MAX_READ;
 *   - compaction pins the CURRENT prompt as the Goal (summariser and the
 *     compacted lead message) and keeps excerpts of the newest tool results
 *     the tail cannot hold; the tail and the excerpts share what is left of
 *     the budget after the reply, the system prompt, the summary and the goal;
 *   - at maxSteps the run makes ONE final request with tools disabled
 *     (STEP_LIMIT_PROMPT) and that reply is the answer; stopReason stays
 *     'max_steps' (a failing final request ends max_steps with its error).
 *
 * DEFERRED: the JSONL session tree (where it lives is open: the session
 * profile denies writes under the Gnomon home, so the kernel would have to
 * read it from the child's stdout or a worktree path).
 */
import { createHash } from 'node:crypto';
import { buildRequest, type ChatMessage, type CompatProfile, type ToolSurface } from './compat.js';
import { complete, type Completion } from './client.js';
import { compactedHistory, DEFAULT_CONTEXT_TARGET, estimateTokens, isContextOverflow, normaliseSummary, summaryMessages } from './compaction.js';
import { parseTextToolCalls, repairArguments, textToolPrompt } from './repair.js';
import { runTool, TOOLS } from './tools.js';
import { surfaceTools } from './compat.js';

/** round 2: the history budget is 85 % of the target minus the native tools schema the request also carries */
export const TARGET_HEADROOM = 0.85;

export type Emit = (ev: Record<string, unknown>) => void;

/** T-2026-10-26-003: the one tool-less request at the step limit asks for this */
export const STEP_LIMIT_PROMPT = 'Step limit reached. Answer the question now from what you have found; say what is unresolved.';

/** round 3 (R4): more tool calls than this in one turn ends the run with an error; none of them runs */
export const MAX_TOOL_CALLS_PER_TURN = 32;

export interface AgentOptions {
  base: string;
  model: string;
  profile: CompatProfile;
  nativeTools: boolean;
  surface: ToolSurface;
  cwd: string;
  /** realpath'd session roots (cwd + worktree); tools refuse paths outside them */
  roots: string[];
  maxSteps: number;
  maxTokens: number;
  systemPrompt?: string;
  forbiddenPorts?: readonly number[];
  /** the working context target in tokens (default 8192, §13.1 ~8k) */
  contextTarget?: number;
  /** Loops step 10: the only tools offered and run (a loop act session's declared tools) */
  allowTools?: readonly string[];
  /** Loops step 10: protected globs write_file refuses */
  protect?: readonly RegExp[];
  emit: Emit;
}

export class Agent {
  readonly #o: AgentOptions;
  /** the tools offered (all, or a loop act session's allowed ones) */
  readonly #tools: typeof TOOLS;
  readonly #messages: ChatMessage[] = [];
  readonly #steer: string[] = [];
  readonly #follow: string[] = [];
  #abort: AbortController | null = null;
  #running = false;
  /** sticky until the run ends: an abort during tools or steering is never lost */
  #aborted = false;
  #turn = 0;
  #compactions = 0;
  /** T-2026-10-26-003: the current prompt (the user message that started this run): compaction's Goal */
  #goal: string | undefined;

  constructor(o: AgentOptions) {
    this.#o = o;
    this.#tools = o.allowTools ? TOOLS.filter((t) => o.allowTools!.includes(t.name)) : TOOLS;
    const sys = [o.systemPrompt ?? 'You are a careful coding agent working in the user\'s project.', !o.nativeTools && o.surface !== 'none' ? textToolPrompt(this.#tools) : ''].filter(Boolean).join('\n\n');
    this.#messages.push({ role: 'system', content: sys });
  }

  get running(): boolean {
    return this.#running;
  }

  state(): Record<string, unknown> {
    return { running: this.#running, turns: this.#turn, messages: this.#messages.length, compactions: this.#compactions, contextTarget: this.#target, queued: { steer: this.#steer.length, followUp: this.#follow.length } };
  }

  get #target(): number {
    return this.#o.contextTarget ?? DEFAULT_CONTEXT_TARGET;
  }

  /** tokens the history + reply may use: target × 0.85 minus the tools schema sent natively */
  get #budget(): number {
    const schema = this.#o.nativeTools ? Math.ceil(JSON.stringify(surfaceTools(this.#tools, this.#o.surface)).length / 4) : 0;
    return Math.floor(this.#target * TARGET_HEADROOM) - schema;
  }

  /** `noTools`: the step-limit request — no tools offered (surface 'none', nativeTools false) */
  #request(noTools = false): Promise<Completion> {
    this.#abort = new AbortController();
    const body = buildRequest(this.#o.profile, { model: this.#o.model, messages: this.#messages, tools: noTools ? [] : this.#tools, nativeTools: noTools ? false : this.#o.nativeTools, surface: noTools ? 'none' : this.#o.surface, maxTokens: this.#o.maxTokens, stream: true });
    return complete(this.#o.base, body, { signal: this.#abort.signal, onDelta: (delta) => this.#o.emit({ type: 'message_update', delta }), ...(this.#o.forbiddenPorts ? { forbiddenPorts: this.#o.forbiddenPorts } : {}) });
  }

  /** One summarising completion, then the history is replaced by system + summary + a safe tail (compaction.ts). */
  async #compact(reason: 'threshold' | 'overflow', total: { input: number; output: number }): Promise<void> {
    const tokensBefore = estimateTokens(this.#messages);
    this.#o.emit({ type: 'compaction_start', reason, tokensBefore });
    this.#abort = new AbortController();
    // round 3: the caps derive from the budget (0.85 × target minus the tools schema), not the raw target
    const budget = Math.max(this.#budget, 256);
    const body = buildRequest(this.#o.profile, { model: this.#o.model, messages: summaryMessages(this.#messages, budget, this.#goal), tools: [], nativeTools: false, surface: 'none', maxTokens: Math.min(1024, Math.max(256, Math.floor(budget / 8))), stream: false });
    let c: Completion;
    try {
      c = await complete(this.#o.base, body, { signal: this.#abort.signal, ...(this.#o.forbiddenPorts ? { forbiddenPorts: this.#o.forbiddenPorts } : {}) });
    } catch (err) {
      this.#o.emit({ type: 'compaction_end', reason, tokensBefore, error: (err as Error).message.slice(0, 500) });
      throw err;
    }
    this.#abort = null;
    if (c.usage) {
      total.input += c.usage.input;
      total.output += c.usage.output;
    }
    const summary = normaliseSummary(c.content, budget);
    // T-2026-10-26-003: the tail and the tool-result excerpts share what the reply, system, summary and goal leave
    const system = this.#messages[0]?.role === 'system' ? estimateTokens([this.#messages[0]]) : 0;
    const fixed = this.#o.maxTokens + system + estimateTokens([{ role: 'user', content: summary }]) + (this.#goal !== undefined ? Math.ceil(this.#goal.length / 4) : 0) + 64;
    const room = Math.max(0, budget - fixed);
    const { messages, kept, excerpts } = compactedHistory(this.#messages, summary, Math.floor(room / 3), { ...(this.#goal !== undefined ? { goal: this.#goal } : {}), excerptTokens: Math.floor(room / 4) });
    this.#messages.splice(0, this.#messages.length, ...messages);
    this.#compactions++;
    this.#o.emit({ type: 'compaction_end', reason, tokensBefore, tokensAfter: estimateTokens(this.#messages), kept, excerpts, usage: c.usage, summaryHash: `sha256:${createHash('sha256').update(summary).digest('hex')}`, summaryBytes: Buffer.byteLength(summary, 'utf8') });
  }

  /**
   * The step limit's answer: STEP_LIMIT_PROMPT (merged into a trailing user message so roles keep alternating), at
   * most one compaction to fit the budget (before the prompt is added), one compact-and-retry on an overflow, then
   * ONE request with tools disabled whose text is the reply (a stray text-tool block is stripped, never run).
   */
  async #finalAnswer(total: { input: number; output: number }): Promise<void> {
    const turn = ++this.#turn;
    this.#o.emit({ type: 'turn_start', turn, final: true });
    const promptTokens = Math.ceil(STEP_LIMIT_PROMPT.length / 4) + 4;
    let compacted = false;
    if (this.#messages.length > 2 && estimateTokens(this.#messages) + promptTokens + this.#o.maxTokens > this.#budget) {
      await this.#compact('threshold', total);
      compacted = true;
    }
    const last = this.#messages.at(-1);
    if (last?.role === 'user') this.#messages.splice(-1, 1, { ...last, content: `${last.content}\n\n${STEP_LIMIT_PROMPT}` });
    else this.#messages.push({ role: 'user', content: STEP_LIMIT_PROMPT });
    if (estimateTokens(this.#messages) + this.#o.maxTokens > this.#budget) throw new Error(`history is over the context budget at the step limit (${estimateTokens(this.#messages)} + ${this.#o.maxTokens} > ${this.#budget} tokens)`);
    let c: Completion;
    try {
      c = await this.#request(true);
    } catch (err) {
      if (this.#aborted || !isContextOverflow(err) || compacted) throw err;
      await this.#compact('overflow', total);
      c = await this.#request(true);
    }
    this.#abort = null;
    if (c.usage) {
      total.input += c.usage.input;
      total.output += c.usage.output;
    }
    const content = this.#o.nativeTools ? c.content : parseTextToolCalls(c.content).rest;
    this.#messages.push({ role: 'assistant', content });
    this.#o.emit({ type: 'message_end', message: { role: 'assistant', content, toolCalls: [] }, usage: c.usage, finishReason: c.finishReason });
    this.#o.emit({ type: 'turn_end', turn, usage: c.usage });
  }

  steer(text: string): void {
    this.#steer.push(text);
  }

  followUp(text: string): void {
    if (this.#running) this.#follow.push(text);
    else void this.prompt(text);
  }

  abort(): void {
    if (this.#running) this.#aborted = true;
    this.#abort?.abort();
  }

  async prompt(text: string): Promise<void> {
    if (this.#running) throw new Error('agent is busy (use steer or follow_up)');
    this.#running = true;
    this.#aborted = false;
    this.#messages.push({ role: 'user', content: text });
    this.#goal = text;
    const total = { input: 0, output: 0 };
    let stopReason = 'stop';
    let error: string | undefined;
    this.#o.emit({ type: 'agent_start' });
    try {
      for (let step = 0; ; step++) {
        if (this.#aborted) {
          stopReason = 'aborted';
          break;
        }
        if (step >= this.#o.maxSteps) {
          stopReason = 'max_steps';
          // T-2026-10-26-003: one tool-less request for an answer; its failure ends max_steps with the error
          try {
            await this.#finalAnswer(total);
          } catch (err) {
            if (this.#aborted || (err as Error).name === 'AbortError') throw err;
            this.#abort = null;
            error = (err as Error).message.slice(0, 500);
          }
          break;
        }
        const turn = ++this.#turn;
        this.#o.emit({ type: 'turn_start', turn });
        // ~8k working target: compact before a request that would not fit (there must be history to compact)
        // round 2: at most ONE compaction per step; still over the budget after it ⇒ a clear error, never a loop
        let compacted = false;
        if (this.#messages.length > 2 && estimateTokens(this.#messages) + this.#o.maxTokens > this.#budget) {
          await this.#compact('threshold', total);
          compacted = true;
          if (estimateTokens(this.#messages) + this.#o.maxTokens > this.#budget) throw new Error(`history is still over the context budget after compaction (${estimateTokens(this.#messages)} + ${this.#o.maxTokens} > ${this.#budget} tokens)`);
        }
        let c: Completion;
        try {
          c = await this.#request();
        } catch (err) {
          // one compact-and-retry when the endpoint refuses the prompt as too long (not if this step already compacted)
          if (this.#aborted || !isContextOverflow(err)) throw err;
          if (compacted) throw new Error(`the endpoint still refuses the prompt as too long after this step's compaction: ${(err as Error).message.slice(0, 200)}`);
          await this.#compact('overflow', total);
          c = await this.#request();
        }
        this.#abort = null;
        const textCalls = !this.#o.nativeTools && this.#o.surface !== 'none' ? parseTextToolCalls(c.content) : { calls: [], rest: c.content };
        // surface 'none' ⇒ never execute a tool call, whatever the model emits (Aegis L4)
        const calls = this.#o.surface === 'none' ? [] : this.#o.nativeTools ? c.toolCalls.map((t) => ({ id: t.id, name: t.name, arguments: t.arguments as unknown })) : textCalls.calls;
        if (c.usage) {
          total.input += c.usage.input;
          total.output += c.usage.output;
        }
        this.#messages.push({
          role: 'assistant',
          content: c.content,
          ...(this.#o.nativeTools && calls.length ? { tool_calls: calls.map((t) => ({ id: t.id, type: 'function' as const, function: { name: t.name, arguments: typeof t.arguments === 'string' ? t.arguments : JSON.stringify(t.arguments) } })) } : {}),
        });
        this.#o.emit({ type: 'message_end', message: { role: 'assistant', content: c.content, toolCalls: calls.map((t) => ({ id: t.id, name: t.name })) }, usage: c.usage, finishReason: c.finishReason });
        if (calls.length > MAX_TOOL_CALLS_PER_TURN) throw new Error(`${calls.length} tool calls in one turn (cap ${MAX_TOOL_CALLS_PER_TURN})`);
        // T-2026-10-26-003: one turn's read_file pages share a quarter of the budget (tokens × 4 chars ⇒ budget bytes)
        const readCap = Math.floor(Math.max(this.#budget, 256) / Math.max(1, calls.filter((t) => t.name === 'read_file').length));
        const results = await Promise.all(
          calls.map(async (t) => {
            const r = repairArguments(t.arguments);
            if (r.repaired) this.#o.emit({ type: 'model_repair', toolCallId: t.id, toolName: t.name, steps: r.steps });
            this.#o.emit({ type: 'tool_execution_start', toolCallId: t.id, toolName: t.name, args: r.ok ? r.value : null });
            const res = r.ok ? await runTool(t.name, r.value!, { cwd: this.#o.cwd, roots: this.#o.roots, readCap, ...(this.#o.allowTools ? { allow: this.#o.allowTools } : {}), ...(this.#o.protect ? { protect: this.#o.protect } : {}) }) : { content: 'arguments are not a JSON object (repair failed)', isError: true };
            this.#o.emit({ type: 'tool_execution_end', toolCallId: t.id, toolName: t.name, isError: res.isError, result: res.content.slice(0, 4096) });
            return { t, res };
          }),
        );
        for (const { t, res } of results) {
          if (this.#o.nativeTools) this.#messages.push({ role: 'tool', tool_call_id: t.id, content: res.content });
          else this.#messages.push({ role: 'user', content: `<tool_result name="${t.name}"${res.isError ? ' error="true"' : ''}>\n${res.content}\n</tool_result>` });
        }
        this.#o.emit({ type: 'turn_end', turn, usage: c.usage });
        const steering = this.#steer.splice(0);
        for (const s of steering) this.#messages.push({ role: 'user', content: s });
        if (!calls.length && !steering.length) break;
      }
    } catch (err) {
      this.#abort = null;
      stopReason = this.#aborted || (err as Error).name === 'AbortError' ? 'aborted' : 'error';
      error = (err as Error).message.slice(0, 500);
    }
    if (this.#aborted) stopReason = 'aborted';
    this.#running = false;
    this.#aborted = false;
    this.#o.emit({ type: 'agent_end', stopReason, usage: total, ...(error ? { error } : {}) });
    const next = this.#follow.shift();
    if (next !== undefined) await this.prompt(next);
  }
}
