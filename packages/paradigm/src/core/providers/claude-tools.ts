/**
 * #claude-provider tools — the tools the Anthropic API provider offers a model.
 *
 * Every path the model supplies (read_file, write_file, search_files and the
 * run_command cwd) must resolve, by realpath, inside the run's working
 * directory; anything else, including a symlink that points out, is refused.
 * run_command is offered and run only as ^command-execution-consent allows
 * (see command-consent.ts) and only if it was offered at run start. write_file
 * also passes #write-guard. Every run_command call, run or refused, is appended
 * to ~/.paradigm/logs/<project-hash>/agent-commands.jsonl (0600, outside the repo).
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { log } from '../../utils/logger.js';
import { resolveContained } from '../../utils/path-containment.js';
import type { CommandGate } from './command-consent.js';
import { checkWrite, writeChecked } from './write-guard.js';
import { runShellCommand } from './command-runner.js';

/** How deep search_files descends. */
export const SEARCH_MAX_DEPTH = 20;

/** Longest command text kept in a log record; the full length is recorded too. */
export const MAX_LOGGED_COMMAND = 4096;

/**
 * Where a project's command log lives: outside the repo, under the user's
 * home, so neither the repo nor the agent's write_file can plant or edit it.
 * ~/.paradigm/logs/<first 16 hex of sha256(realpath of root)>/agent-commands.jsonl
 */
export function commandLogPathFor(workingDirectory: string, home: string): string {
  let root = path.resolve(workingDirectory);
  try {
    root = fs.realpathSync.native(workingDirectory);
  } catch {
    // Not there (yet): hash the resolved path.
  }
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 16);
  return path.join(home, '.paradigm', 'logs', hash, 'agent-commands.jsonl');
}

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
  /**
   * Whether run_command was offered when the run started. If it wasn't, it is
   * refused for the whole run, even if the saved setting changes meanwhile.
   */
  commandsOffered: boolean;
  /** Absolute path of the append-only command log (see commandLogPathFor). */
  commandLogPath: string;
  /** Agent name, recorded in the command log. */
  agent?: string;
  /** run_command timeout in ms. */
  timeout?: number;
  mcpServerPath?: string;
  /** Absolute trees write_file never touches (#write-guard), e.g. ~/.paradigm, ~/.claude. */
  deniedWrites?: string[];
  /** Filled with allowed-but-sensitive writes (package.json, portal.yaml, ...) for the run summary. */
  reviewWrites?: Set<string>;
}

export interface CommandLogRecord {
  timestamp: string;
  /** Real path of the working directory, so a hashed log folder can be traced back. */
  project?: string;
  agent?: string;
  /** Command text, cut to MAX_LOGGED_COMMAND characters. */
  command: string;
  /** Full length of the command text. */
  commandLength?: number;
  cwd: string;
  /** Exit code; null when refused, timed out or killed by a signal. */
  exitCode: number | null;
  signal?: string;
  timedOut?: boolean;
  /** Present when the command was not run. */
  refused?: string;
  durationMs?: number;
}

export function toolDefinitions(ctx: Pick<ToolContext, 'gate' | 'mcpServerPath' | 'commandsOffered'>): ToolDefinition[] {
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

  // Offered only if it was offered at run start AND still is (a "no" to the
  // consent question removes it; nothing adds it mid-run).
  if (ctx.commandsOffered && ctx.gate.isOffered()) {
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
      const content = String(input.content ?? '');
      // #write-guard runs before any directory is created.
      const verdict = checkWrite(root, input.path, content, { deniedAbsolute: ctx.deniedWrites });
      if (!verdict.ok) {
        log.component('claude-provider').debug('write_file refused', { path: String(input.path), reason: verdict.reason });
        return `Error: ${verdict.reason}`;
      }
      writeChecked(verdict.real, content);
      if (verdict.review) {
        ctx.reviewWrites?.add(verdict.review);
        log.component('claude-provider').debug('write_file wrote a file to review', { file: verdict.review });
      }
      return `Written to ${path.relative(fs.realpathSync.native(root), verdict.real)}`;
    }

    case 'search_files': {
      const searchPath = input.path
        ? resolveContained(root, input.path as string, { allowRoot: true })
        : resolveContained(root, '.', { allowRoot: true });
      if (!searchPath) return outside('path', input.path);
      const pattern = input.pattern;
      if (typeof pattern !== 'string' || pattern === '' || path.isAbsolute(pattern) ||
          /^[\\/]/.test(pattern) || /[{}]/.test(pattern) || pattern.split(/[\\/]/).includes('..')) {
        return `Error: pattern ${JSON.stringify(pattern)} must be a relative glob without "..", braces or a leading slash.`;
      }
      const files = await glob(pattern, { cwd: searchPath, follow: false, nobrace: true, maxDepth: SEARCH_MAX_DEPTH });
      return files
        .filter((f) => resolveContained(fs.realpathSync.native(root), path.join(searchPath, f)) !== null)
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

  if (!ctx.commandsOffered) {
    recordCommand(ctx, { ...base, exitCode: null, refused: 'not offered at run start' });
    return 'Error: run_command was not offered for this run, so it cannot be used.';
  }

  if (!command) {
    recordCommand(ctx, { ...base, exitCode: null, refused: 'empty command' });
    return 'Error: command is required.';
  }

  const cmdCwd = resolveContained(ctx.workingDirectory, requestedCwd as string, { allowRoot: true });
  if (!cmdCwd) {
    recordCommand(ctx, { ...base, exitCode: null, refused: 'cwd outside working directory' });
    return outside('cwd', requestedCwd);
  }
  base.cwd = cmdCwd;

  const decision = await ctx.gate.authorize(command, cmdCwd);
  if (!decision.allowed) {
    recordCommand(ctx, { ...base, exitCode: null, refused: decision.reason });
    return `Error: ${decision.reason}`;
  }

  const started = Date.now();
  const r = await runShellCommand(command, { cwd: cmdCwd, timeoutMs: ctx.timeout || 30000 });
  recordCommand(ctx, {
    ...base,
    exitCode: r.exitCode,
    ...(r.signal ? { signal: r.signal } : {}),
    ...(r.timedOut ? { timedOut: true } : {}),
    durationMs: Date.now() - started,
  });
  if (r.exitCode === 0 && !r.timedOut) return r.stdout;
  const detail = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();
  const status = r.timedOut
    ? `timed out after ${ctx.timeout || 30000} ms; its process group was killed`
    : r.exitCode !== null ? `exit code ${r.exitCode}` : `stopped${r.signal ? ` by ${r.signal}` : ''}`;
  return `Error: command failed (${status})${detail ? `\n${detail}` : ''}`;
}

/**
 * Append one record to the command log and send it to the Paradigm logger.
 * Never records environment values. Logging failures never fail the tool.
 */
export function recordCommand(
  ctx: Pick<ToolContext, 'workingDirectory' | 'commandLogPath'>,
  record: CommandLogRecord,
): void {
  const full = record.command;
  let project: string | undefined;
  try {
    project = fs.realpathSync.native(ctx.workingDirectory);
  } catch {
    project = ctx.workingDirectory;
  }
  const entry: CommandLogRecord = {
    ...record,
    project,
    command: full.length > MAX_LOGGED_COMMAND ? full.slice(0, MAX_LOGGED_COMMAND) : full,
    commandLength: full.length,
  };
  log.component('claude-provider').debug(entry.refused ? 'run_command refused' : 'run_command ran', {
    command: entry.command,
    cwd: entry.cwd,
    exitCode: entry.exitCode,
    timestamp: entry.timestamp,
    ...(entry.refused ? { refused: entry.refused } : {}),
  });
  try {
    fs.mkdirSync(path.dirname(ctx.commandLogPath), { recursive: true, mode: 0o700 });
    const { O_WRONLY, O_APPEND, O_CREAT } = fs.constants;
    const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
    const fd = fs.openSync(ctx.commandLogPath, O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW, 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify(entry)}\n`);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // The log must not break the agent run.
  }
}
