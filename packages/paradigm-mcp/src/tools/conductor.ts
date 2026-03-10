/**
 * Conductor MCP Tools — Register/unregister Claude Code sessions with Conductor
 *
 * Tools:
 * - paradigm_conductor_register: Register this session so Conductor can find it
 * - paradigm_conductor_unregister: Remove this session from Conductor
 * - paradigm_conductor_list: List all registered sessions
 */

import { execSync } from 'child_process';
import type { ProjectContext } from '../utils/index-loader.js';
import {
  registerConductorSession,
  unregisterConductorSession,
  listConductorSessions,
  cleanStaleSessions,
  detectTerminalBundleId,
  detectGitBranch,
} from '../utils/conductor-loader.js';

/**
 * Get list of conductor tools
 */
export function getConductorToolsList() {
  return [
    {
      name: 'paradigm_conductor_register',
      description:
        'Register this Claude Code session with Paradigm Conductor. Makes the session visible in the Conductor overlay for voice/gesture/gaze dispatch. Call this when the user says "/conduct" or wants to surface a session to Conductor. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description: 'Human-readable label for this session (e.g., "backend refactor", "auth feature")',
          },
          terminal: {
            type: 'string',
            description: 'Terminal bundle ID (e.g., "com.mitchellh.ghostty"). Auto-detected if omitted.',
          },
        },
        required: [],
      },
      annotations: {
        title: 'Register with Conductor',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: 'paradigm_conductor_unregister',
      description:
        'Unregister this Claude Code session from Paradigm Conductor. Removes it from the Conductor overlay. Call when ending a session or when the user wants to hide from Conductor. ~50 tokens.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
      annotations: {
        title: 'Unregister from Conductor',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: 'paradigm_conductor_list',
      description:
        'List all Claude Code sessions currently registered with Paradigm Conductor. Shows PIDs, project dirs, and labels. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          clean: {
            type: 'boolean',
            description: 'If true, clean up stale sessions (dead PIDs) before listing',
          },
        },
        required: [],
      },
      annotations: {
        title: 'List Conductor sessions',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ];
}

/**
 * Handle conductor tool calls
 */
export async function handleConductorTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean }> {
  switch (name) {
    case 'paradigm_conductor_register': {
      const pid = process.pid;
      const projectDir = ctx.rootDir;

      // Try to detect terminal (use provided value or auto-detect)
      const terminal = (args.terminal as string | undefined) || detectTerminalBundleId();

      // Try to detect branch
      const branch = detectGitBranch(projectDir);

      // Try to get parent PID
      let parentPid: number | undefined;
      try {
        const ppid = execSync(`ps -o ppid= -p ${pid}`, {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        parentPid = parseInt(ppid, 10);
        if (isNaN(parentPid)) parentPid = undefined;
      } catch {}

      const session = registerConductorSession({
        pid,
        parentPid,
        projectDir,
        terminal,
        label: args.label as string | undefined,
        branch,
      });

      const lines = [
        `✓ Registered with Conductor`,
        ``,
        `  PID: ${session.pid}`,
        `  Project: ${session.projectDir}`,
      ];
      if (session.branch) lines.push(`  Branch: ${session.branch}`);
      if (session.label) lines.push(`  Label: ${session.label}`);
      if (session.terminal) lines.push(`  Terminal: ${session.terminal}`);
      lines.push(`  File: ~/.conductor/sessions/${session.pid}.json`);
      lines.push(``);
      lines.push(`This session is now visible in Paradigm Conductor.`);
      lines.push(`Conductor will auto-discover it via the registration file.`);

      return { text: lines.join('\n'), handled: true };
    }

    case 'paradigm_conductor_unregister': {
      const pid = process.pid;
      const removed = unregisterConductorSession(pid);

      if (removed) {
        return {
          text: `✓ Unregistered from Conductor (PID ${pid}).\nThis session is no longer visible in the Conductor overlay.`,
          handled: true,
        };
      } else {
        return {
          text: `Session (PID ${pid}) was not registered with Conductor.`,
          handled: true,
        };
      }
    }

    case 'paradigm_conductor_list': {
      if (args.clean) {
        const cleaned = cleanStaleSessions();
        if (cleaned > 0) {
          // Will show in output below
        }
      }

      const sessions = listConductorSessions();

      if (sessions.length === 0) {
        return {
          text: 'No sessions registered with Conductor.\nUse paradigm_conductor_register or /conduct to register.',
          handled: true,
        };
      }

      const lines = [`${sessions.length} session(s) registered with Conductor:\n`];
      for (const s of sessions) {
        const parts = [`  PID ${s.pid}`];
        if (s.label) parts.push(`"${s.label}"`);
        parts.push(`— ${s.projectDir}`);
        if (s.branch) parts.push(`(${s.branch})`);
        lines.push(parts.join(' '));
      }

      if (args.clean) {
        lines.push(`\n(Stale sessions cleaned)`);
      }

      return { text: lines.join('\n'), handled: true };
    }

    default:
      return { text: '', handled: false };
  }
}

