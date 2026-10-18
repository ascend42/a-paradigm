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
 * DEFERRED: the JSONL session tree (where it lives is open: the session
 * profile denies writes under the Gnomon home, so the kernel would have to
 * read it from the child's stdout or a worktree path).
 */
import { buildRequest, type ChatMessage, type CompatProfile, type ToolSurface } from './compat.js';
import { complete, type Completion } from './client.js';
import { compactedHistory, DEFAULT_CONTEXT_TARGET, estimateTokens, isContextOverflow, normaliseSummary, summaryMessages } from './compaction.js';
import { parseTextToolCalls, repairArguments, textToolPrompt } from './repair.js';
import { runTool, TOOLS } from './tools.js';

export type Emit = (ev: Record<string, unknown>) => void;

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
  emit: Emit;
}

export class Agent {
  readonly #o: AgentOptions;
  readonly #messages: ChatMessage[] = [];
  readonly #steer: string[] = [];
  readonly #follow: string[] = [];
  #abort: AbortController | null = null;
  #running = false;
  /** sticky until the run ends: an abort during tools or steering is never lost */
  #aborted = false;
  #turn = 0;
  #compactions = 0;

  constructor(o: AgentOptions) {
    this.#o = o;
    const sys = [o.systemPrompt ?? 'You are a careful coding agent working in the user\'s project.', !o.nativeTools && o.surface !== 'none' ? textToolPrompt(TOOLS) : ''].filter(Boolean).join('\n\n');
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

  #request(): Promise<Completion> {
    this.#abort = new AbortController();
    const body = buildRequest(this.#o.profile, { model: this.#o.model, messages: this.#messages, tools: TOOLS, nativeTools: this.#o.nativeTools, surface: this.#o.surface, maxTokens: this.#o.maxTokens, stream: true });
    return complete(this.#o.base, body, { signal: this.#abort.signal, onDelta: (delta) => this.#o.emit({ type: 'message_update', delta }), ...(this.#o.forbiddenPorts ? { forbiddenPorts: this.#o.forbiddenPorts } : {}) });
  }

  /** One summarising completion, then the history is replaced by system + summary + a safe tail (compaction.ts). */
  async #compact(reason: 'threshold' | 'overflow', total: { input: number; output: number }): Promise<void> {
    const target = this.#target;
    const tokensBefore = estimateTokens(this.#messages);
    this.#o.emit({ type: 'compaction_start', reason, tokensBefore });
    this.#abort = new AbortController();
    const body = buildRequest(this.#o.profile, { model: this.#o.model, messages: summaryMessages(this.#messages, target), tools: [], nativeTools: false, surface: 'none', maxTokens: Math.min(1024, Math.max(256, Math.floor(target / 8))), stream: false });
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
    const { messages, kept } = compactedHistory(this.#messages, normaliseSummary(c.content, target), Math.floor(target / 4));
    this.#messages.splice(0, this.#messages.length, ...messages);
    this.#compactions++;
    this.#o.emit({ type: 'compaction_end', reason, tokensBefore, tokensAfter: estimateTokens(this.#messages), kept, usage: c.usage });
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
          break;
        }
        const turn = ++this.#turn;
        this.#o.emit({ type: 'turn_start', turn });
        // ~8k working target: compact before a request that would not fit (there must be history to compact)
        if (this.#messages.length > 2 && estimateTokens(this.#messages) + this.#o.maxTokens > this.#target) await this.#compact('threshold', total);
        let c: Completion;
        try {
          c = await this.#request();
        } catch (err) {
          // one compact-and-retry when the endpoint refuses the prompt as too long; a second overflow is an error
          if (this.#aborted || !isContextOverflow(err)) throw err;
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
        const results = await Promise.all(
          calls.map(async (t) => {
            const r = repairArguments(t.arguments);
            if (r.repaired) this.#o.emit({ type: 'model_repair', toolCallId: t.id, toolName: t.name, steps: r.steps });
            this.#o.emit({ type: 'tool_execution_start', toolCallId: t.id, toolName: t.name, args: r.ok ? r.value : null });
            const res = r.ok ? await runTool(t.name, r.value!, { cwd: this.#o.cwd, roots: this.#o.roots }) : { content: 'arguments are not a JSON object (repair failed)', isError: true };
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
