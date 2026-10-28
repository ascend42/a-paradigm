/**
 * #claude-provider tools — the tools the Anthropic API provider offers a model.
 *
 * Every path the model supplies (read_file, write_file, search_files and the
 * run_command cwd) must resolve, by realpath, inside the run's working
 * directory; anything else, including a symlink that points out, is refused.
 * run_command is offered and run only as ^command-execution-consent allows
 * (see command-consent.ts), and every call, run or refused, is appended to
 * .paradigm/events/agent-commands.jsonl in the working directory.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { log } from '../../utils/logger.js';
import { resolveContained } from '../../utils/path-containment.js';
import type { CommandGate } from './command-consent.js';

export const COMMAND_LOG_FILE = path.join('.paradigm', 'events', 'agent-commands.jsonl');

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface ToolContext {
  /** The run's working directory. Every model-supplied path stays inside it. */
  workingDirectory: string;
  gate: CommandGate;
  /** Agent name, recorded in the command log. */
  agent?: string;
  /** run_command timeout in ms. */
  timeout?: number;
  mcpServerPath?: string;
}

export interface CommandLogRecord {
  timestamp: string;
  agent?: string;
  command: string;
  cwd: string;
  /** Exit code; null when refused, timed out or killed by a signal. */
  exitCode: number | null;
  signal?: string;
  /** Present when the command was not run. */
  refused?: string;
  durationMs?: number;
}

export function toolDefinitions(ctx: Pick<ToolContext, 'gate' | 'mcpServerPath'>): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      name: 'read_file',
      description: 'Read a file inside the working directory',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the working directory' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Write content to a file inside the working directory',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the working directory' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'search_files',
      description: 'Search for files matching a glob pattern inside the working directory',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (relative, no ..)' },
          path: { type: 'string', description: 'Directory to search in, relative to the working directory' },
        },
        required: ['pattern'],
      },
    },
  ];

  if (ctx.gate.isOffered()) {
    tools.push({
      name: 'run_command',
      description: 'Run a shell command in the working directory (or a folder inside it)',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to run' },
          cwd: { type: 'string', description: 'Folder inside the working directory' },
        },
        required: ['command'],
      },
    });
  }

  if (ctx.mcpServerPath) {
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

function outside(kind: string, p: unknown): string {
  return `Error: ${kind} ${JSON.stringify(p)} is outside the working directory (or is a symlink that leads out). Use a path inside it.`;
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const root = ctx.workingDirectory;

  switch (name) {
    case 'read_file': {
      const filePath = resolveContained(root, input.path as string);
      if (!filePath) return outside('path', input.path);
      return fs.readFileSync(filePath, 'utf-8');
    }

    case 'write_file': {
      const filePath = resolveContained(root, input.path as string, { allowMissing: true });
      if (!filePath) return outside('path', input.path);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, String(input.content ?? ''));
      return `Written to ${path.relative(fs.realpathSync(root), filePath)}`;
    }

    case 'search_files': {
      const searchPath = input.path
        ? resolveContained(root, input.path as string, { allowRoot: true })
        : resolveContained(root, '.', { allowRoot: true });
      if (!searchPath) return outside('path', input.path);
      const pattern = input.pattern;
      if (typeof pattern !== 'string' || pattern === '' || path.isAbsolute(pattern) ||
          pattern.split(/[\\/]/).includes('..')) {
        return `Error: pattern ${JSON.stringify(pattern)} must be a relative glob without "..".`;
      }
      const files = await glob(pattern, { cwd: searchPath, follow: false });
      return files
        .filter((f) => resolveContained(root, path.join(searchPath, f)) !== null)
        .join('\n');
    }

    case 'run_command':
      return runCommand(input, ctx);

    case 'mcp_call':
      // Placeholder for MCP integration
      return `MCP tool ${input.tool} called with ${JSON.stringify(input.args)}`;

    default:
      return `Unknown tool: ${name}`;
  }
}

async function runCommand(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const command = typeof input.command === 'string' ? input.command : '';
  const requestedCwd = input.cwd === undefined || input.cwd === '' ? '.' : input.cwd;
  const base: Omit<CommandLogRecord, 'exitCode'> = {
    timestamp: new Date().toISOString(),
    agent: ctx.agent,
    command,
    cwd: String(requestedCwd),
  };

  if (!command) {
    recordCommand(ctx.workingDirectory, { ...base, exitCode: null, refused: 'empty command' });
    return 'Error: command is required.';
  }

  const cmdCwd = resolveContained(ctx.workingDirectory, requestedCwd as string, { allowRoot: true });
  if (!cmdCwd) {
    recordCommand(ctx.workingDirectory, { ...base, exitCode: null, refused: 'cwd outside working directory' });
    return outside('cwd', requestedCwd);
  }
  base.cwd = cmdCwd;

  const decision = await ctx.gate.authorize(command, cmdCwd);
  if (!decision.allowed) {
    recordCommand(ctx.workingDirectory, { ...base, exitCode: null, refused: decision.reason });
    return `Error: ${decision.reason}`;
  }

  const started = Date.now();
  try {
    const output = execSync(command, {
      cwd: cmdCwd,
      encoding: 'utf-8',
      timeout: ctx.timeout || 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    recordCommand(ctx.workingDirectory, { ...base, exitCode: 0, durationMs: Date.now() - started });
    return output;
  } catch (error) {
    const e = error as { status?: number | null; signal?: string | null; stdout?: string; stderr?: string; message?: string };
    const exitCode = typeof e.status === 'number' ? e.status : null;
    recordCommand(ctx.workingDirectory, {
      ...base,
      exitCode,
      ...(e.signal ? { signal: e.signal } : {}),
      durationMs: Date.now() - started,
    });
    const detail = [e.stdout, e.stderr].filter(Boolean).join('\n').trim();
    const status = exitCode !== null ? `exit code ${exitCode}` : `stopped${e.signal ? ` by ${e.signal}` : ''}`;
    return `Error: command failed (${status})${detail ? `\n${detail}` : e.message ? `\n${e.message}` : ''}`;
  }
}

/**
 * Append one record to the command log and send it to the Paradigm logger.
 * Never records environment values. Logging failures never fail the tool.
 */
export function recordCommand(workingDirectory: string, record: CommandLogRecord): void {
  // debug, not info: the logger writes to stdout, which carries --json output
  // and the MCP protocol when the orchestrator runs inside an MCP server. The
  // file below is the durable log.
  log.component('claude-provider').debug(record.refused ? 'run_command refused' : 'run_command ran', {
    command: record.command,
    cwd: record.cwd,
    exitCode: record.exitCode,
    timestamp: record.timestamp,
    ...(record.refused ? { refused: record.refused } : {}),
  });
  try {
    // A repo could ship the log path as a symlink to, say, ~/.zshrc; the
    // record holds model-written text, so only ever append inside the project.
    const file = resolveContained(workingDirectory, COMMAND_LOG_FILE, { allowMissing: true });
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf-8');
  } catch {
    // The log must not break the agent run.
  }
}
