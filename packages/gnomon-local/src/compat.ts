/**
 * @symbol #gnomon-local
 * @symbol ^subscription-only
 *
 * The compat ALLOWLIST (spec §13.1): only OpenAI-compatible LOCAL transports
 * — llama.cpp server, Ollama, LM Studio, vLLM, `mlx_lm.server`. pi-ai's
 * cloud providers are not in the build at all (this package has zero
 * dependencies; test/local-child.test.ts scans src/ and dist/ for cloud SDKs and
 * hosts). A profile name outside this table is refused by the config loader.
 *
 * Every profile is seeded from the llama.cpp preset (pi-ai's compat flags,
 * re-derived): no `developer` role (system prompts go as `system`), no
 * `store`, `max_tokens` (not `max_completion_tokens`), usage requested on the
 * stream; llama.cpp additionally takes the qwen chat-template thinking switch
 * (`chat_template_kwargs.enable_thinking`).
 */

export interface CompatProfile {
  readonly api: 'openai-completions';
  readonly developerRole: false;
  readonly store: false;
  readonly maxTokensField: 'max_tokens';
  /** qwen chat-template thinking via chat_template_kwargs (llama.cpp) */
  readonly thinkingKwarg: boolean;
  /** /slots exposes n_ctx (llama.cpp only) */
  readonly slots: boolean;
  /** platforms where the transport is first-class (§16: MLX is Mac-only) */
  readonly platforms: readonly string[];
}

const preset = (o: Partial<Pick<CompatProfile, 'thinkingKwarg' | 'slots' | 'platforms'>>): CompatProfile =>
  Object.freeze({ api: 'openai-completions', developerRole: false, store: false, maxTokensField: 'max_tokens', thinkingKwarg: false, slots: false, platforms: Object.freeze(['darwin', 'win32', 'linux']), ...o });

export const COMPAT_ALLOWLIST: Readonly<Record<string, CompatProfile>> = Object.freeze({
  'llama.cpp': preset({ thinkingKwarg: true, slots: true }),
  ollama: preset({}),
  'lm-studio': preset({}),
  vllm: preset({ platforms: Object.freeze(['linux', 'win32']) }),
  'mlx-lm': preset({ platforms: Object.freeze(['darwin']) }),
});

export type ToolSurface = 'none' | 'compact' | 'full';

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the arguments object */
  parameters: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface RequestInput {
  model: string;
  messages: ChatMessage[];
  tools: readonly ToolSpec[];
  /** native tools only when the probe detected them (§13.1: tools off unless detected) */
  nativeTools: boolean;
  surface: ToolSurface;
  maxTokens: number;
  stream: boolean;
  thinking?: boolean;
}

/** The compact surface: names + one-line descriptions, argument schemas reduced to property names and types. */
export function surfaceTools(tools: readonly ToolSpec[], surface: ToolSurface): ToolSpec[] {
  if (surface === 'none') return [];
  if (surface === 'full') return tools.map((t) => ({ ...t }));
  return tools.map((t) => {
    const props = (t.parameters.properties ?? {}) as Record<string, { type?: string }>;
    const compact: Record<string, { type: string }> = {};
    for (const [k, v] of Object.entries(props)) compact[k] = { type: typeof v?.type === 'string' ? v.type : 'string' };
    return { name: t.name, description: t.description.split('\n')[0]!.slice(0, 120), parameters: { type: 'object', properties: compact, required: (t.parameters.required as string[] | undefined) ?? [] } };
  });
}

/** The completions request body for a profile (never a `developer` role, never `store`). */
export function buildRequest(profile: CompatProfile, i: RequestInput): Record<string, unknown> {
  const messages = i.messages.map((m) => ({ ...m, role: (m.role as string) === 'developer' ? 'system' : m.role }));
  const body: Record<string, unknown> = { model: i.model, messages, [profile.maxTokensField]: i.maxTokens, stream: i.stream, temperature: 0 };
  if (i.stream) body.stream_options = { include_usage: true };
  const tools = i.nativeTools ? surfaceTools(i.tools, i.surface) : [];
  if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: t }));
  if (profile.thinkingKwarg && i.thinking !== undefined) body.chat_template_kwargs = { enable_thinking: i.thinking };
  return body;
}
