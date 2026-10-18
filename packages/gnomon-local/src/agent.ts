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
 * DEFERRED (slice 2): compaction re-derived at the ~8k working target with
 * the fixed headings Goal/Constraints/Progress/Decisions/Next/Critical and
 * one compact-and-retry; the JSONL session tree.
 */
import { buildRequest, type ChatMessage, type CompatProfile, type ToolSurface } from './compat.js';
import { complete } from './client.js';
import { parseTextToolCalls, repairArguments, textToolPrompt } from './repair.js';
import { runTool, TOOLS } from './tools.js';

export type Emit = (ev: Record<string, unknown>) => void;

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

  constructor(o: AgentOptions) {
    this.#o = o;
    const sys = [o.systemPrompt ?? 'You are a careful coding agent working in the user\'s project.', !o.nativeTools && o.surface !== 'none' ? textToolPrompt(TOOLS) : ''].filter(Boolean).join('\n\n');
    this.#messages.push({ role: 'system', content: sys });
  }

  get running(): boolean {
    return this.#running;
  }

  state(): Record<string, unknown> {
    return { running: this.#running, turns: this.#turn, messages: this.#messages.length, queued: { steer: this.#steer.length, followUp: this.#follow.length } };
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
        this.#abort = new AbortController();
        const body = buildRequest(this.#o.profile, { model: this.#o.model, messages: this.#messages, tools: TOOLS, nativeTools: this.#o.nativeTools, surface: this.#o.surface, maxTokens: this.#o.maxTokens, stream: true });
        const c = await complete(this.#o.base, body, { signal: this.#abort.signal, onDelta: (delta) => this.#o.emit({ type: 'message_update', delta }), ...(this.#o.forbiddenPorts ? { forbiddenPorts: this.#o.forbiddenPorts } : {}) });
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
