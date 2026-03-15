/**
 * Platform Bridge — HTTP helper for MCP → Platform Server communication
 *
 * Sends agent commands to the Platform server's POST /api/platform/agent-command
 * endpoint, which then broadcasts via WebSocket to connected browsers.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * Resolve the platform server port from config.yaml, fallback to 3850
 */
export function resolvePlatformPort(projectDir: string): number {
  try {
    const configPath = path.join(projectDir, '.paradigm', 'config.yaml');
    if (fs.existsSync(configPath)) {
      const config = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      const platform = config.platform as Record<string, unknown> | undefined;
      if (platform?.port && typeof platform.port === 'number') {
        return platform.port;
      }
    }
  } catch {
    // Fall through to default
  }
  return 3850;
}

/**
 * Resolve agent identity for platform commands.
 * Reuses Symphony's identity resolution pattern.
 */
export function resolveAgentId(projectDir: string): string {
  try {
    const configPath = path.join(projectDir, '.paradigm', 'config.yaml');
    if (fs.existsSync(configPath)) {
      const config = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      const project = (config.project as string) || path.basename(projectDir);
      const role = (config.role as string) || 'core';
      return `${project}/${role}`;
    }
  } catch {
    // Fall through
  }
  return `${path.basename(projectDir)}/core`;
}

export interface AgentCommandResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Send a command to the Platform server
 */
export async function sendAgentCommand(
  projectDir: string,
  command: string,
  payload: Record<string, unknown>,
): Promise<AgentCommandResult> {
  const port = resolvePlatformPort(projectDir);
  const agentId = resolveAgentId(projectDir);
  const url = `http://localhost:${port}/api/platform/agent-command`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, agentId, payload }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: `HTTP ${response.status}: ${text}` };
    }

    const data = await response.json() as Record<string, unknown>;
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Platform server unreachable (${msg}). Is \`paradigm serve\` running?` };
  }
}
