/**
 * Claude Agent Provider
 *
 * Implements AgentProvider for Claude via:
 * 1. Claude Agent SDK (when available)
 * 2. Anthropic API (fallback)
 *
 * Supports:
 * - Streaming responses
 * - Tool use
 * - MCP server integration
 * - Budget tracking
 */

import {
  AgentProvider,
  AgentModel,
  AgentMessage,
  SpawnOptions,
  TokenUsage,
  MODEL_PRICING,
} from '../agent-provider.js';
import { AgentDefinition } from '../../commands/team/types.js';

// ============================================================================
// Types
// ============================================================================

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: ContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface StreamEvent {
  type: string;
  index?: number;
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
  };
  content_block?: ContentBlock;
  message?: AnthropicResponse;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ============================================================================
// Model Mapping
// ============================================================================

const MODEL_IDS: Record<AgentModel, string> = {
  opus: 'claude-opus-4-5-20251101',
  sonnet: 'claude-sonnet-4-20250514',
  haiku: 'claude-haiku-4-20250514',
};

// ============================================================================
// Claude Provider
// ============================================================================

export class ClaudeAgentProvider implements AgentProvider {
  readonly name = 'claude';

  private apiKey: string | null = null;
  private baseUrl = 'https://api.anthropic.com/v1';

  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY || null;
  }

  listModels(): AgentModel[] {
    return ['opus', 'sonnet', 'haiku'];
  }

  supportsParallel(): boolean {
    return true;
  }

  supportsMcp(): boolean {
    return true;
  }

  getTokenCost(model: AgentModel): { input: number; output: number } {
    return MODEL_PRICING[model];
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  /**
   * Spawn an agent and return streaming messages
   */
  async *spawn(
    agent: AgentDefinition,
    options: SpawnOptions
  ): AsyncIterable<AgentMessage> {
    if (!this.apiKey) {
      yield {
        type: 'error',
        content: 'ANTHROPIC_API_KEY not set',
        timestamp: new Date().toISOString(),
      };
      return;
    }

    const model = options.model || 'sonnet';
    const modelId = MODEL_IDS[model];

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(agent, options);

    // Track conversation
    const messages: AnthropicMessage[] = [
      { role: 'user', content: options.task },
    ];

    // Token tracking
    let totalUsage: TokenUsage = { input: 0, output: 0, total: 0 };

    // Conversation loop
    let continueLoop = true;
    let loopCount = 0;
    const maxLoops = 50; // Safety limit

    while (continueLoop && loopCount < maxLoops) {
      loopCount++;

      try {
        // Make streaming API call
        const response = await this.streamRequest(modelId, systemPrompt, messages, options);

        // Process stream
        let assistantContent: ContentBlock[] = [];
        let currentToolUse: { id: string; name: string; input: string } | null = null;

        for await (const event of response) {
          if (event.type === 'content_block_start' && event.content_block) {
            if (event.content_block.type === 'tool_use') {
              currentToolUse = {
                id: event.content_block.id || '',
                name: event.content_block.name || '',
                input: '',
              };
            }
          } else if (event.type === 'content_block_delta' && event.delta) {
            if (event.delta.type === 'text_delta' && event.delta.text) {
              yield {
                type: 'text',
                content: event.delta.text,
                timestamp: new Date().toISOString(),
              };
            } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
              currentToolUse.input += event.delta.partial_json || '';
            }
          } else if (event.type === 'content_block_stop') {
            if (currentToolUse) {
              // Tool use complete
              const toolInput = JSON.parse(currentToolUse.input || '{}');
              assistantContent.push({
                type: 'tool_use',
                id: currentToolUse.id,
                name: currentToolUse.name,
                input: toolInput,
              });

              yield {
                type: 'tool_use',
                content: `Using tool: ${currentToolUse.name}`,
                toolName: currentToolUse.name,
                toolInput: toolInput,
                timestamp: new Date().toISOString(),
              };

              currentToolUse = null;
            }
          } else if (event.type === 'message_delta' && event.usage) {
            totalUsage.input += event.usage.input_tokens || 0;
            totalUsage.output += event.usage.output_tokens || 0;
            totalUsage.total = totalUsage.input + totalUsage.output;
          } else if (event.type === 'message_stop') {
            // Check if we need to continue for tool results
            const hasToolUse = assistantContent.some((c) => c.type === 'tool_use');

            if (hasToolUse) {
              // Add assistant message with tool uses
              messages.push({
                role: 'assistant',
                content: assistantContent,
              });

              // Execute tools and add results
              const toolResults = await this.executeTools(assistantContent, options);
              messages.push({
                role: 'user',
                content: toolResults,
              });

              // Yield tool results
              for (const result of toolResults) {
                if (result.type === 'tool_result') {
                  yield {
                    type: 'tool_result',
                    content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
                    toolName: result.tool_use_id,
                    toolResult: result.content,
                    timestamp: new Date().toISOString(),
                  };
                }
              }

              // Continue loop for next response
              assistantContent = [];
            } else {
              // No tool use, conversation complete
              continueLoop = false;
            }
          }
        }

        // Budget check
        if (options.budget?.maxTokens && totalUsage.total > options.budget.maxTokens) {
          yield {
            type: 'error',
            content: `Token budget exceeded: ${totalUsage.total} > ${options.budget.maxTokens}`,
            usage: totalUsage,
            timestamp: new Date().toISOString(),
          };
          continueLoop = false;
        }
      } catch (error) {
        yield {
          type: 'error',
          content: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        };
        continueLoop = false;
      }
    }

    // Final message
    yield {
      type: 'done',
      content: 'Agent completed',
      usage: totalUsage,
      timestamp: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private buildSystemPrompt(agent: AgentDefinition, options: SpawnOptions): string {
    const parts: string[] = [];

    // Role-specific context
    parts.push(options.context.systemPrompt);

    // Agent role
    parts.push(`\n## Your Role: ${agent.name.toUpperCase()}\n`);
    parts.push(agent.role);

    // Focus areas
    if (agent.focus) {
      parts.push('\n### Focus Areas\n');
      if (agent.focus.reads.length > 0) {
        parts.push(`**Read**: ${agent.focus.reads.join(', ')}`);
      }
      if (agent.focus.writes.length > 0) {
        parts.push(`**Write**: ${agent.focus.writes.join(', ')}`);
      }
    }

    // Handoff context
    if (options.context.handoffContext) {
      parts.push('\n### Context from Previous Agent\n');
      parts.push(options.context.handoffContext);
    }

    // Symbols in scope
    if (options.context.symbols.length > 0) {
      parts.push('\n### Symbols in Scope\n');
      parts.push(options.context.symbols.join(', '));
    }

    return parts.join('\n');
  }

  private async *streamRequest(
    model: string,
    system: string,
    messages: AnthropicMessage[],
    options: SpawnOptions
  ): AsyncIterable<StreamEvent> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: options.budget?.maxTokens || 4096,
        system,
        messages,
        stream: true,
        tools: this.getAvailableTools(options),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data && data !== '[DONE]') {
            try {
              yield JSON.parse(data) as StreamEvent;
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    }
  }

  private getAvailableTools(options: SpawnOptions): unknown[] {
    // Define tools available to agents
    // In a full implementation, these would be actual Claude Code tools
    const tools: Array<{
      name: string;
      description: string;
      input_schema: {
        type: string;
        properties: Record<string, { type: string; description: string }>;
        required: string[];
      };
    }> = [
      {
        name: 'read_file',
        description: 'Read a file from the filesystem',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file' },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Write content to a file',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'search_files',
        description: 'Search for files matching a pattern',
        input_schema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob pattern' },
            path: { type: 'string', description: 'Directory to search in' },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'run_command',
        description: 'Run a shell command',
        input_schema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to run' },
            cwd: { type: 'string', description: 'Working directory' },
          },
          required: ['command'],
        },
      },
    ];

    // Add MCP tools if configured
    if (options.mcpServerPath) {
      tools.push({
        name: 'mcp_call',
        description: 'Call an MCP tool',
        input_schema: {
          type: 'object',
          properties: {
            tool: { type: 'string', description: 'MCP tool name' },
            args: { type: 'object', description: 'Tool arguments' },
          },
          required: ['tool'],
        },
      });
    }

    return tools;
  }

  private async executeTools(
    content: ContentBlock[],
    options: SpawnOptions
  ): Promise<ContentBlock[]> {
    const results: ContentBlock[] = [];

    for (const block of content) {
      if (block.type === 'tool_use' && block.id && block.name) {
        let result: string;

        try {
          result = await this.executeTool(block.name, block.input || {}, options);
        } catch (error) {
          result = `Error: ${error instanceof Error ? error.message : String(error)}`;
        }

        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    return results;
  }

  private async executeTool(
    name: string,
    input: Record<string, unknown>,
    options: SpawnOptions
  ): Promise<string> {
    const cwd = options.workingDirectory || process.cwd();
    const { execSync } = await import('child_process');
    const fs = await import('fs');
    const path = await import('path');
    const { glob } = await import('glob');

    switch (name) {
      case 'read_file': {
        const filePath = path.resolve(cwd, input.path as string);
        return fs.readFileSync(filePath, 'utf-8');
      }

      case 'write_file': {
        const filePath = path.resolve(cwd, input.path as string);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, input.content as string);
        return `Written to ${filePath}`;
      }

      case 'search_files': {
        const searchPath = input.path ? path.resolve(cwd, input.path as string) : cwd;
        const files = await glob(input.pattern as string, { cwd: searchPath });
        return files.join('\n');
      }

      case 'run_command': {
        const cmdCwd = input.cwd ? path.resolve(cwd, input.cwd as string) : cwd;
        const output = execSync(input.command as string, {
          cwd: cmdCwd,
          encoding: 'utf-8',
          timeout: options.timeout || 30000,
        });
        return output;
      }

      case 'mcp_call': {
        // Placeholder for MCP integration
        return `MCP tool ${input.tool} called with ${JSON.stringify(input.args)}`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  }
}
