/**
 * @symbol #gnomon-local
 *
 * The context LEDGER (slice B1, TD-2026-10-27-833): one pure function that
 * splits the working target (`contextTarget`, ~8k) into slots, replacing the
 * agent's ad hoc #budget. Every number is a token ESTIMATE (compaction.ts
 * estimateTokens' 4 chars a token), never model text about usage.
 *
 *   usable  = floor(target × TARGET_HEADROOM)        (0.85, round 2)
 *   system  = the system message (its text-tool prompt NOT included)
 *   memory  = the kernel's working-memory block (slice B2, memory_set): its
 *             estimate, never above memorySlotTokens(target) =
 *             min(1000, 12 % of the target) (the child refuses a bigger one)
 *   tools   = the native tools schema sent with the request, or the
 *             text-tool prompt carried inside the system message
 *   reply   = maxTokens
 *   history = usable − system − memory − tools − reply   (≥ 0)
 *
 * messageBudget is what the agent compares `estimateTokens(messages) +
 * reply` against: usable − memory − (the native schema, when tools go
 * natively). Messages include the system message — and, in text-tool mode,
 * the tool prompt inside it — so this is exactly the old
 * `floor(target × 0.85) − schema` (round 2) while memory is 0.
 *
 * resultCapChars is shaping's cap for one tool result in a turn of `calls`
 * calls: min(SHAPE_CAP_TOKENS, the history slot's share) in chars, never
 * below MIN_SHAPE_CHARS.
 */
import { CHARS_PER_TOKEN, MIN_SHAPE_CHARS, SHAPE_CAP_TOKENS } from './shape.js';

/** round 2: the history budget is 85 % of the target minus the native tools schema the request also carries */
export const TARGET_HEADROOM = 0.85;

export interface LedgerInput {
  target: number;
  /** tokens of the system message (with the text-tool prompt when `toolsInSystem`) */
  systemMessageTokens: number;
  /** tokens of the tools: the native schema, or the text-tool prompt */
  toolsTokens: number;
  /** the tools travel inside the system message (text-tool mode) rather than as a native schema */
  toolsInSystem: boolean;
  /** the reply budget (maxTokens) */
  replyTokens: number;
  /** slice B2: the memory block (default 0) */
  memoryTokens?: number;
  headroom?: number;
}

export interface ContextSlots {
  system: number;
  memory: number;
  tools: number;
  history: number;
  reply: number;
}

export interface ContextLedger {
  target: number;
  usable: number;
  slots: ContextSlots;
  /** estimateTokens(messages) + reply must stay at or under this (messages include the system message) */
  messageBudget: number;
}

const nat = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** Slice B2: the working-memory slot is at most this many tokens … */
export const MEMORY_SLOT_MAX_TOKENS = 1000;
/** … and at most this share of the target. */
export const MEMORY_SLOT_SHARE = 0.12;

/** Slice B2 (#local-working-memory): the memory slot of a target: min(1000 tokens, 12 % of the target). */
export function memorySlotTokens(target: number): number {
  return Math.min(MEMORY_SLOT_MAX_TOKENS, Math.floor(nat(target) * MEMORY_SLOT_SHARE));
}

export function contextLedger(i: LedgerInput): ContextLedger {
  const usable = Math.floor(nat(i.target) * (i.headroom ?? TARGET_HEADROOM));
  const tools = nat(i.toolsTokens);
  const memory = nat(i.memoryTokens ?? 0);
  const reply = nat(i.replyTokens);
  const system = Math.max(0, nat(i.systemMessageTokens) - (i.toolsInSystem ? tools : 0));
  const history = Math.max(0, usable - system - memory - tools - reply);
  return { target: nat(i.target), usable, slots: { system, memory, tools, history, reply }, messageBudget: usable - memory - (i.toolsInSystem ? 0 : tools) };
}

/** Shaping's cap (chars) for one result of a turn with `calls` tool calls: min(capTokens, history / calls) tokens. */
export function resultCapChars(l: ContextLedger, calls: number, capTokens = SHAPE_CAP_TOKENS): number {
  const share = Math.floor(l.slots.history / Math.max(1, calls));
  return Math.max(MIN_SHAPE_CHARS, Math.min(capTokens, share) * CHARS_PER_TOKEN);
}

/** The context_report event the agent emits at each turn start (runner.ts parses it; the kernel logs it). */
export function contextReport(l: ContextLedger, turn: number, compactions: number, historyUsed: number): Record<string, unknown> {
  return { type: 'context_report', turn, target: l.target, slots: { ...l.slots }, historyUsed: nat(historyUsed), compactions };
}
