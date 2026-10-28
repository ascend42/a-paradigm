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
 * Slice B1 (TD-2026-10-27-833):
 *   - the context LEDGER (budget.ts) replaces the ad hoc #budget: slots
 *     system / memory (0 until B2) / tools (native schema or text-tool
 *     prompt) / history / reply, same 0.85 headroom; every turn start emits
 *     `context_report{turn, target, slots, historyUsed, compactions}`;
 *   - every tool result is SHAPED (shape.ts) under min(1500 tokens, the
 *     history slot's share of the turn); an over-cap result keeps its head and
 *     a spill handle `@rN` read back with read_section; the read_file page is
 *     sized under the same cap so its paging note survives;
 *   - the session's spill store and the set of files the model wrote live on
 *     the agent (session lifetime).
 *
 * Slice C1 (#local-tool-broker, TD-2026-10-27-833): BROKERED tools. The
 * kernel offers them with tools_set (rpc.ts → setBrokered); the set takes
 * effect at the next step start (the offered tools, the system message's
 * text-tool prompt and the ledger's tools slot are rebuilt then). A call to a
 * brokered tool validates its args against the OFFERED schema, emits
 * tool_request and waits for tool_response (broker.ts: timeout, the run's
 * abort ends it as an error result); the result is shaped like any other,
 * labelled by its provenance. A name in neither the native nor the current
 * brokered set is "unknown tool" (the allowTools rule). A session with an
 * allowTools list (a loop act session) never takes brokered tools.
 *
 * Slice B2 (#local-working-memory, TD-2026-10-27-833): the KERNEL owns the
 * session's working memory and pushes its rendered block with memory_set; the
 * agent keeps it OUTSIDE the history and places it at request time as a fixed
 * slot right after the system prompt (inside the system message, before the
 * text-tool prompt), so compaction never touches it. The ledger's memory slot
 * is the block's estimate; a block over memorySlotTokens(target) (min(1000,
 * 12 %)) is refused. With `memory: true` the model gets note/forget
 * (memory-tools.ts), brokered to the kernel like any kernel tool. compact{}
 * compacts at the next model step (a run in flight: its next step; idle: the
 * first step of the next run, so the summariser always rides a turn's permit);
 * set_context{target} clamps to [1024, n_ctx] and the 0.85 rule and applies at
 * the next step start (at once when idle). A block that pins the current goal
 * (goalHash) turns plan A's goal restatement off (compaction.ts).
 *
 * DEFERRED: the JSONL session tree (where it lives is open: the session
 * profile denies writes under the Gnomon home, so the kernel would have to
 * read it from the child's stdout or a worktree path).
 */
import { createHash } from 'node:crypto';
import { buildRequest, orderTools, surfaceTools, type ChatMessage, type CompatProfile, type ToolSpec, type ToolSurface } from './compat.js';
import { complete, type Completion } from './client.js';
import { compactedHistory, DEFAULT_CONTEXT_TARGET, estimateTokens, isContextOverflow, normaliseSummary, summaryMessages } from './compaction.js';
import { contextLedger, contextReport, memoryBlockTokens, memorySlotTokens, resultCapChars, TARGET_HEADROOM, type ContextLedger } from './budget.js';
import { MEMORY_TOOLS } from './memory-tools.js';
import { FIND_TOOL } from './find-tool.js';

/** slice C3' (Aegis M3): a kernel tools_set id (ts-N), echoed in tools_applied when the set takes effect. */
export const TOOLS_SET_ID_RE = /^ts-[1-9]\d{0,8}$/;
import { parseTextToolCalls, repairArguments, textToolPrompt } from './repair.js';
import { neutraliseResult, shapeResult, SHAPE_CAP_CHARS, SpillStore } from './shape.js';
import { runTool, TOOLS } from './tools.js';
import { CONTEXT_TARGET_MAX, sha256, validateArgs, type BrokeredToolSpec, type ContextCommand, type KernelToolBroker } from './broker.js';
import type { ToolResult } from './confine.js';

export { TARGET_HEADROOM } from './budget.js';

/** Slice B1: room a read_file page leaves under its shaping cap for the paging note. */
const PAGE_NOTE_CHARS = 300;

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
  /** Slice C1: the kernel port brokered calls go through (absent: no brokered tools) */
  broker?: KernelToolBroker;
  /** Slice B2: the session has kernel working memory (memory_set accepted, note/forget offered; needs `broker`) */
  memory?: boolean;
  /** Slice B2: the endpoint's context (set_context never goes above it); null/absent = unknown */
  nCtx?: number | null;
  emit: Emit;
}

/** Slice B2: the smallest context target set_context applies. */
export const MIN_CONTEXT_TARGET = 1024;

/** Slice B2: the working-memory block in effect (memory_set). */
export interface MemoryBlock {
  render: string;
  hash: string;
  bytes: number;
  goalHash?: string;
}

/** Slice B2: a memory block's tokens in the system message (the estimate, plus its two-char separator). */
const memoryTokensOf = (m: MemoryBlock | null): number => (m ? memoryBlockTokens(m.render) : 0);
/** Aegis B2 M1: the data section of a memory block (dropped once on a context overflow). */
const MODEL_OPEN_PREFIX = '<working-memory source="model"';
/** Where a block's data section starts (a data-only render starts at 0; Aegis B2 re-check), or -1 when it has none. */
const dataSectionAt = (render: string): number => (render.startsWith(MODEL_OPEN_PREFIX) ? 0 : render.indexOf(`\n${MODEL_OPEN_PREFIX}`));

export class Agent {
  readonly #o: AgentOptions;
  /** the native tools offered (all, or a loop act session's allowed ones) */
  readonly #native: typeof TOOLS;
  /** slice C1: what this step offers — the native tools, then the brokered ones (rebuilt at a step start) */
  #tools: ToolSpec[] = [];
  /** slice C1: the brokered set in effect (this step) and the one the kernel set for the next step */
  #brokered: BrokeredToolSpec[] = [];
  #nextBrokered: BrokeredToolSpec[] | null = null;
  /** slice C3' (Aegis M3): the kernel's id of the pending tools_set; acknowledged with tools_applied{id} when it takes effect */
  #nextBrokeredId: string | null = null;
  readonly #messages: ChatMessage[] = [];
  readonly #steer: string[] = [];
  readonly #follow: string[] = [];
  #abort: AbortController | null = null;
  /** Aegis M2: one per prompt run, passed to the tools as ctx.signal; abort() fires it */
  #runAbort = new AbortController();
  #running = false;
  /** sticky until the run ends: an abort during tools or steering is never lost */
  #aborted = false;
  #turn = 0;
  #compactions = 0;
  /** T-2026-10-26-003: the current prompt (the user message that started this run): compaction's Goal */
  #goal: string | undefined;
  /** slice B1: the context ledger (slice C1: rebuilt when the brokered set changes, at a step start) */
  #ledger!: ContextLedger;
  /** slice B1: full text of shaped results (`@rN`), session lifetime */
  readonly #spill = new SpillStore();
  /** slice B1: realpaths the model wrote this session (reads of them are labelled model-generated) */
  readonly #written = new Set<string>();
  /** slice B2: the working context target (set_context changes it at a step start) and the one set for the next step */
  #target: number;
  #nextTarget: number | null = null;
  /** slice B2: the kernel's working-memory block (outside the history) and the one set for the next step */
  #memory: MemoryBlock | null = null;
  #nextMemory: MemoryBlock | null = null;
  /** Aegis B2 M1: after a context overflow the block goes without its data section, until the next memory_set */
  #memoryLean = false;
  /** slice B2: the human asked to compact (applied at the next model step) */
  #compactNext = false;
  /** slice B2: the system prompt and the text-tool prompt (the memory block goes between them at request time) */
  #sysBase = '';
  #sysTools = '';

  constructor(o: AgentOptions) {
    this.#o = o;
    this.#target = o.contextTarget ?? DEFAULT_CONTEXT_TARGET;
    this.#native = orderTools(o.allowTools ? TOOLS.filter((t) => o.allowTools!.includes(t.name)) : TOOLS);
    this.#messages.push({ role: 'system', content: '' });
    this.#applyTools();
  }

  /** The offered tools, the system message (its text-tool prompt) and the ledger, from the native + brokered sets. */
  #applyTools(): void {
    const o = this.#o;
    // brokered tools follow the natives (orderTools keeps names outside TOOL_ORDER last, in the kernel's order);
    // slice B2: the memory tools (note, forget) come before the kernel's brokered ones
    this.#tools = orderTools([...this.#native, ...[...this.#memoryTools, ...this.#findTool, ...this.#brokered].map((b) => ({ name: b.name, description: b.description, parameters: b.parameters }))]);
    const textTools = !o.nativeTools && o.surface !== 'none' ? textToolPrompt(this.#tools) : '';
    this.#sysBase = o.systemPrompt ?? 'You are a careful coding agent working in the user\'s project.';
    this.#sysTools = textTools;
    const sys = [this.#sysBase, textTools].filter(Boolean).join('\n\n');
    if (this.#messages[0]?.role === 'system') this.#messages[0] = { role: 'system', content: sys };
    const schema = o.nativeTools ? Math.ceil(JSON.stringify(surfaceTools(this.#tools, o.surface)).length / 4) : 0;
    this.#ledger = contextLedger({ target: this.#target, systemMessageTokens: estimateTokens([this.#messages[0]!]), toolsTokens: o.nativeTools ? schema : Math.ceil(textTools.length / 4), toolsInSystem: !o.nativeTools, replyTokens: o.maxTokens, memoryTokens: memoryTokensOf(this.#memory) });
  }

  /** Slice B2: the memory tools this session offers (none without memory, a broker, or with a tools allowlist). */
  get #memoryTools(): readonly BrokeredToolSpec[] {
    return this.#o.memory && this.#o.broker && !this.#o.allowTools && this.#o.surface !== 'none' ? MEMORY_TOOLS : [];
  }

  /**
   * Slice C3': find_tool, the one meta-tool, offered with the kernel's brokered tools (none without them, without a
   * broker, with a tools allowlist or with surface none). The kernel resolves it and sends the next step's tools_set.
   */
  get #findTool(): readonly BrokeredToolSpec[] {
    return this.#o.broker && !this.#o.allowTools && this.#o.surface !== 'none' && this.#brokered.length > 0 ? [FIND_TOOL] : [];
  }

  /** The system message as the request carries it: the system prompt, the memory block, then the text-tool prompt. */
  #requestMessages(): ChatMessage[] {
    if (!this.#memory || this.#messages[0]?.role !== 'system') return this.#messages;
    const cut = this.#memoryLean ? dataSectionAt(this.#memory.render) : -1;
    const render = cut >= 0 ? this.#memory.render.slice(0, cut) : this.#memory.render;
    const sys: ChatMessage = { role: 'system', content: [this.#sysBase, render, this.#sysTools].filter(Boolean).join('\n\n') };
    return [sys, ...this.#messages.slice(1)];
  }

  /**
   * Slice B2: the kernel's memory_set. Refused (an error string) when this session has no memory or the block is over
   * the memory slot of the target in effect from the next step. Applied at the next step start (at once when idle).
   */
  setMemory(m: Extract<ContextCommand, { op: 'memory_set' }>): string | null {
    if (!this.#o.memory) return 'this session has no working memory';
    const block: MemoryBlock = { render: m.render, hash: m.hash, bytes: m.bytes, ...(m.goalHash !== undefined ? { goalHash: m.goalHash } : {}) };
    const slot = memorySlotTokens(this.#nextTarget ?? this.#target);
    const tokens = memoryTokensOf(block);
    if (tokens > slot) return `the memory block is over the memory slot (${tokens} > ${slot} tokens)`;
    this.#nextMemory = block;
    if (!this.#running) this.#takePending();
    return null;
  }

  /** Slice B2: compact{} — at the next model step: this run's next step, or the next run's first. */
  requestCompact(): 'next-step' | 'next-run' {
    this.#compactNext = true;
    return this.#running ? 'next-step' : 'next-run';
  }

  /**
   * Slice B2: set_context{target}. Clamped to [MIN_CONTEXT_TARGET, n_ctx] and raised to the least target the 0.85
   * rule allows for the reply budget (maxTokens < 0.85 x target); refused when even n_ctx cannot hold the reply.
   * Applied at the next step start (at once when idle).
   */
  setContextTarget(requested: number): { contextTarget: number; requested: number; clamped: boolean } | { error: string } {
    const nCtx = typeof this.#o.nCtx === 'number' && this.#o.nCtx > 0 ? this.#o.nCtx : CONTEXT_TARGET_MAX;
    const floor085 = Math.floor(this.#o.maxTokens / TARGET_HEADROOM) + 1;
    if (floor085 > nCtx) return { error: `the reply budget (${this.#o.maxTokens}) leaves no room under 0.85 x n_ctx ${nCtx}` };
    const t = Math.min(nCtx, Math.max(MIN_CONTEXT_TARGET, floor085, requested));
    this.#nextTarget = t;
    if (!this.#running) this.#takePending();
    return { contextTarget: t, requested, clamped: t !== requested };
  }

  /** Slice B2: the context target in effect. */
  get contextTarget(): number {
    return this.#target;
  }

  /** Slice B2: the memory block in effect (tests, get_state). */
  get memory(): Readonly<MemoryBlock> | null {
    return this.#memory;
  }

  /** At a step start (or at once when idle): the brokered set, the memory block and the target the kernel set. */
  #takePending(): void {
    let changed = false;
    if (this.#nextBrokered !== null) {
      this.#brokered = this.#nextBrokered;
      // Aegis M3: the kernel keeps the previous set callable until it reads this acknowledgement
      if (this.#nextBrokeredId !== null) this.#o.emit({ type: 'tools_applied', id: this.#nextBrokeredId });
      this.#nextBrokeredId = null;
      this.#nextBrokered = null;
      changed = true;
    }
    if (this.#nextMemory !== null) {
      this.#memory = this.#nextMemory;
      this.#nextMemory = null;
      this.#memoryLean = false;
      changed = true;
    }
    if (this.#nextTarget !== null) {
      this.#target = this.#nextTarget;
      this.#nextTarget = null;
      changed = true;
    }
    if (changed) this.#applyTools();
  }

  /**
   * Slice C1: the kernel's tools_set. Takes effect at the next step start. Refused (an error string) when this agent
   * has no broker port or is a loop act session (allowTools).
   */
  setBrokered(tools: readonly BrokeredToolSpec[], id?: unknown): string | null {
    if (!this.#o.broker) return 'this session has no kernel broker';
    if (this.#o.allowTools) return 'a session with a tools allowlist takes no brokered tools';
    this.#nextBrokered = tools.map((t) => ({ ...t }));
    this.#nextBrokeredId = typeof id === 'string' && TOOLS_SET_ID_RE.test(id) ? id : null;
    if (!this.#running) this.#takePending();
    return null;
  }

  /** The brokered names in effect (tests, get_state). */
  get brokered(): string[] {
    return this.#brokered.map((b) => b.name);
  }

  get running(): boolean {
    return this.#running;
  }

  state(): Record<string, unknown> {
    return { running: this.#running, turns: this.#turn, messages: this.#messages.length, compactions: this.#compactions, contextTarget: this.#target, queued: { steer: this.#steer.length, followUp: this.#follow.length }, brokered: this.brokered.length, outstanding: this.#o.broker?.outstanding ?? 0, memory: this.#memory ? { bytes: this.#memory.bytes, hash: this.#memory.hash } : null, compactNext: this.#compactNext };
  }

  /** tokens the messages (system included) + reply may use: the ledger's messageBudget (target × 0.85 minus the native schema) */
  get #budget(): number {
    return this.#ledger.messageBudget;
  }

  /** slice B1: the slot report at a turn start */
  #report(turn: number): void {
    this.#o.emit(contextReport(this.#ledger, turn, this.#compactions, estimateTokens(this.#messages.slice(1))));
  }

  /** `noTools`: the step-limit request — no tools offered (surface 'none', nativeTools false) */
  /**
   * Aegis B2 M1: one request; on a context overflow with a memory data section still sent, ONE retry without it
   * (`memory_trimmed`), before the caller's compact-and-retry. Compaction cannot shrink the memory block; this can.
   */
  async #request(noTools = false): Promise<Completion> {
    try {
      return await this.#requestOnce(noTools);
    } catch (err) {
      if (this.#aborted || !isContextOverflow(err) || this.#memoryLean || !this.#memory || dataSectionAt(this.#memory.render) < 0) throw err;
      this.#memoryLean = true;
      this.#o.emit({ type: 'memory_trimmed', reason: 'overflow' });
      return this.#requestOnce(noTools);
    }
  }

  #requestOnce(noTools = false): Promise<Completion> {
    this.#abort = new AbortController();
    const body = buildRequest(this.#o.profile, { model: this.#o.model, messages: this.#requestMessages(), tools: noTools ? [] : this.#tools, nativeTools: noTools ? false : this.#o.nativeTools, surface: noTools ? 'none' : this.#o.surface, maxTokens: this.#o.maxTokens, stream: true });
    return complete(this.#o.base, body, { signal: this.#abort.signal, onDelta: (delta) => this.#o.emit({ type: 'message_update', delta }), ...(this.#o.forbiddenPorts ? { forbiddenPorts: this.#o.forbiddenPorts } : {}) });
  }

  /** One summarising completion, then the history is replaced by system + summary + a safe tail (compaction.ts). */
  async #compact(reason: 'threshold' | 'overflow' | 'manual', total: { input: number; output: number }): Promise<void> {
    const tokensBefore = estimateTokens(this.#messages);
    this.#o.emit({ type: 'compaction_start', reason, tokensBefore });
    this.#abort = new AbortController();
    // round 3: the caps derive from the budget (0.85 × target minus the tools schema), not the raw target
    const budget = Math.max(this.#budget, 256);
    // slice B2: working memory pins THIS goal verbatim => the summary and the lead message do not restate it
    const goalPinned = this.#goal !== undefined && this.#memory?.goalHash !== undefined && this.#memory.goalHash === sha256(this.#goal);
    const body = buildRequest(this.#o.profile, { model: this.#o.model, messages: summaryMessages(this.#messages, budget, this.#goal, goalPinned), tools: [], nativeTools: false, surface: 'none', maxTokens: Math.min(1024, Math.max(256, Math.floor(budget / 8))), stream: false });
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
    const summary = normaliseSummary(c.content, budget, goalPinned);
    // T-2026-10-26-003: the tail and the tool-result excerpts share what the reply, system, summary and goal leave
    const system = this.#messages[0]?.role === 'system' ? estimateTokens([this.#messages[0]]) : 0;
    const fixed = this.#o.maxTokens + system + estimateTokens([{ role: 'user', content: summary }]) + (this.#goal !== undefined && !goalPinned ? Math.ceil(this.#goal.length / 4) : 0) + 64;
    const room = Math.max(0, budget - fixed);
    const { messages, kept, excerpts } = compactedHistory(this.#messages, summary, Math.floor(room / 3), { ...(this.#goal !== undefined ? { goal: this.#goal } : {}), excerptTokens: Math.floor(room / 4), ...(goalPinned ? { goalPinned } : {}) });
    this.#messages.splice(0, this.#messages.length, ...messages);
    this.#compactions++;
    this.#o.emit({ type: 'compaction_end', reason, tokensBefore, tokensAfter: estimateTokens(this.#messages), kept, excerpts, goalPinned, usage: c.usage, summaryHash: `sha256:${createHash('sha256').update(summary).digest('hex')}`, summaryBytes: Buffer.byteLength(summary, 'utf8') });
  }

  /**
   * The step limit's answer: STEP_LIMIT_PROMPT (merged into a trailing user message so roles keep alternating), at
   * most one compaction to fit the budget (before the prompt is added), one compact-and-retry on an overflow, then
   * ONE request with tools disabled whose text is the reply (a stray text-tool block is stripped, never run).
   */
  async #finalAnswer(total: { input: number; output: number }): Promise<void> {
    const turn = ++this.#turn;
    this.#o.emit({ type: 'turn_start', turn, final: true });
    this.#report(turn);
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

  /** Slice C1: one brokered call — the args against the OFFERED schema, then the kernel (broker.ts). */
  async #brokeredCall(b: BrokeredToolSpec, toolCallId: string, args: Record<string, unknown>): Promise<ToolResult> {
    const bad = validateArgs(b.parameters, args);
    if (bad) return { content: `${b.name}: ${bad}`, isError: true };
    return this.#o.broker!.request(b, String(toolCallId ?? ''), args, this.#runAbort.signal);
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
    // Aegis M2: the run's tools (grep's walk) see it too; slice C1 (G-LCL-15): so do brokered calls in flight
    if (this.#running) this.#runAbort.abort();
    this.#o.broker?.cancelAll();
  }

  async prompt(text: string): Promise<void> {
    if (this.#running) throw new Error('agent is busy (use steer or follow_up)');
    this.#running = true;
    this.#aborted = false;
    this.#runAbort = new AbortController();
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
        // slice C1: a tools_set received during the last step applies from this step on (slice B2: and the memory
        // block and the context target the kernel set)
        this.#takePending();
        const brokered = [...this.#memoryTools, ...this.#findTool, ...this.#brokered];
        const turn = ++this.#turn;
        this.#o.emit({ type: 'turn_start', turn });
        this.#report(turn);
        // ~8k working target: compact before a request that would not fit (there must be history to compact)
        // round 2: at most ONE compaction per step; still over the budget after it ⇒ a clear error, never a loop
        let compacted = false;
        // slice B2: the human's compact{} — this step, before the request (one compaction per step still holds)
        if (this.#compactNext && this.#messages.length > 2) {
          this.#compactNext = false;
          await this.#compact('manual', total);
          compacted = true;
        }
        if (!compacted && this.#messages.length > 2 && estimateTokens(this.#messages) + this.#o.maxTokens > this.#budget) {
          await this.#compact('threshold', total);
          compacted = true;
        }
        if (compacted) {
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
        // slice B1: each result of this turn is shaped under min(1500 tokens, the history slot's share)
        const resultCap = resultCapChars(this.#ledger, calls.length);
        // T-2026-10-26-003: one turn's read_file pages share a quarter of the budget (tokens × 4 chars ⇒ budget bytes);
        // slice B1: never more than the shaping cap less the paging note, so a page is never spilled
        const reads = Math.max(1, calls.filter((t) => t.name === 'read_file').length);
        const readCap = Math.min(Math.floor(Math.min(Math.max(this.#budget, 256), SHAPE_CAP_CHARS - PAGE_NOTE_CHARS) / reads), resultCap - PAGE_NOTE_CHARS);
        const results = await Promise.all(
          calls.map(async (t) => {
            const r = repairArguments(t.arguments);
            if (r.repaired) this.#o.emit({ type: 'model_repair', toolCallId: t.id, toolName: t.name, steps: r.steps });
            this.#o.emit({ type: 'tool_execution_start', toolCallId: t.id, toolName: t.name, args: r.ok ? r.value : null });
            const b = r.ok ? brokered.find((x) => x.name === t.name) : undefined;
            const raw = b ? await this.#brokeredCall(b, t.id, r.value!) : r.ok ? await runTool(t.name, r.value!, { cwd: this.#o.cwd, roots: this.#o.roots, readCap, resultCap, spill: this.#spill, written: this.#written, signal: this.#runAbort.signal, ...(this.#o.allowTools ? { allow: this.#o.allowTools } : {}), ...(this.#o.protect ? { protect: this.#o.protect } : {}) }) : { content: 'arguments are not a JSON object (repair failed)', isError: true };
            // slice B1: shaping is the final cap of every result (G-LCL-12)
            const res = shapeResult(raw, { cap: resultCap, spill: this.#spill, tool: t.name.slice(0, 64) });
            this.#o.emit({ type: 'tool_execution_end', toolCallId: t.id, toolName: t.name, isError: res.isError, result: res.content.slice(0, 4096) });
            return { t, res };
          }),
        );
        for (const { t, res } of results) {
          if (this.#o.nativeTools) this.#messages.push({ role: 'tool', tool_call_id: t.id, content: res.content });
          // Aegis M5: the body can never close or forge the block (a repo file holding `</tool_result>`): a labelled result
          // was neutralised inside its frame by shapeResult (its own frame must survive); any other body is neutralised
          // here. The name is model text: reduced to [\w.-].
          else this.#messages.push({ role: 'user', content: `<tool_result name="${t.name.slice(0, 64).replace(/[^\w.-]/g, '_')}"${res.isError ? ' error="true"' : ''}>\n${res.source ? res.content : neutraliseResult(res.content)}\n</tool_result>` });
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
