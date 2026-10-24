/**
 * @symbol #gnomon-local
 *
 * Argument repair and the text-tool fallback (spec §13.1; OpenCode's
 * tool-input-repair idea and Odysseus' text tools, RE-DERIVED — no code
 * lifted, Odysseus is AGPL).
 *
 * repairArguments: local models emit almost-JSON. The repair ladder is
 * deterministic and each step is named (the `model.repair{argument}` row
 * carries the steps): fence strip → smart quotes → single-quoted strings →
 * unquoted keys → trailing commas → close an unterminated string → balance
 * brackets → unwrap a double-encoded string. Only a JSON OBJECT is accepted;
 * anything else fails (the tool then returns an error result to the model,
 * never a guessed call).
 *
 * Text tools: when the endpoint has no native tool calls (the probe found
 * none), the tool list is described in the system prompt and calls are read
 * back from `<tool_call>{"name":…,"arguments":{…}}</tool_call>` blocks.
 */
import type { ToolSpec } from './compat.js';

export interface RepairResult {
  ok: boolean;
  value?: Record<string, unknown>;
  repaired: boolean;
  steps: string[];
}

function tryObject(s: string): Record<string, unknown> | undefined {
  try {
    let v: unknown = JSON.parse(s);
    if (typeof v === 'string') v = JSON.parse(v);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function balance(s: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if ((ch === '}' || ch === ']') && stack[stack.length - 1] === ch) stack.pop();
  }
  return (inStr ? `${s}"` : s) + stack.reverse().join('');
}

const STEPS: Array<[string, (s: string) => string]> = [
  ['fence', (s) => s.replace(/^\s*```[a-z]*\s*/i, '').replace(/\s*```\s*$/, '')],
  ['smart-quotes', (s) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")],
  ['single-quotes', (s) => s.replace(/'((?:[^'\\]|\\.)*)'/g, (_m, inner: string) => JSON.stringify(inner.replace(/\\'/g, "'")))],
  ['unquoted-keys', (s) => s.replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":')],
  ['trailing-commas', (s) => s.replace(/,\s*([}\]])/g, '$1')],
  ['balance', balance],
];

export function repairArguments(raw: unknown): RepairResult {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) return { ok: true, value: raw as Record<string, unknown>, repaired: false, steps: [] };
  if (typeof raw !== 'string') return { ok: false, repaired: false, steps: [] };
  const direct = tryObject(raw.trim() === '' ? '{}' : raw);
  if (direct) return { ok: true, value: direct, repaired: false, steps: [] };
  let s = raw.trim();
  const steps: string[] = [];
  for (const [name, f] of STEPS) {
    const next = f(s);
    if (next !== s) {
      steps.push(name);
      s = next;
    }
    const v = tryObject(s);
    if (v) return { ok: true, value: v, repaired: true, steps };
  }
  return { ok: false, repaired: false, steps };
}

/** The system-prompt block that describes tools for the text fallback. */
export function textToolPrompt(tools: readonly ToolSpec[]): string {
  if (!tools.length) return '';
  const lines = tools.map((t) => `- ${t.name}: ${t.description.split('\n')[0]} — arguments: ${JSON.stringify(t.parameters.properties ?? {})}`);
  return [
    'You can call tools. To call one, reply with exactly one block per call:',
    '<tool_call>{"name": "<tool name>", "arguments": { ... }}</tool_call>',
    'Tool results come back in <tool_result> blocks. Available tools:',
    ...lines,
  ].join('\n');
}

export interface TextToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

/** Read `<tool_call>` blocks out of model text; returns the calls and the text with the blocks removed. */
export function parseTextToolCalls(text: string): { calls: TextToolCall[]; rest: string } {
  const calls: TextToolCall[] = [];
  const rest = text.replace(/<tool_call>([\s\S]*?)(<\/tool_call>|$)/g, (_m, body: string) => {
    const r = repairArguments(body);
    if (r.ok && typeof r.value?.name === 'string') calls.push({ id: `text-${calls.length + 1}`, name: r.value.name, arguments: r.value.arguments ?? r.value.args ?? {} });
    return '';
  });
  return { calls, rest: rest.trim() };
}
