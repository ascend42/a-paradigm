/**
 * @symbol #gnomon-local
 *
 * `--mode rpc` (spec §3.3 `#local-runner` argv, §13.1; the JSONL shape of
 * pi's rpc-entry.ts, re-derived): one JSON object per line each way.
 *
 * stdin commands  {id?, type: 'prompt'|'steer'|'follow_up', message}
 *                 {id?, type: 'abort'} {id?, type: 'get_state'}
 * stdout          {type:'response', id?, command, success, data?, error?}
 *                 and agent events: model_capabilities, agent_start,
 *                 turn_start, message_update{delta}, message_end{message,
 *                 usage}, model_repair, tool_execution_start/_end, turn_end,
 *                 compaction_start/_end (slice 2), agent_end{stopReason,
 *                 usage}; `fatal{error}` before exit.
 *
 * The session config is the kernel-written `local.yaml` (the JSON subset of
 * YAML: every JSON document is YAML 1.2), validated strictly; an endpoint
 * outside loopback/LAN or a compat profile outside the allowlist is FATAL
 * (exit 3) — never a fallback to anything else.
 */
import { realpathSync } from 'node:fs';
import { Agent, type Emit } from './agent.js';
import { COMPAT_ALLOWLIST, type ToolSurface } from './compat.js';
import { classifyEndpoint } from './endpoint.js';

export interface LocalSessionConfig {
  schemaVersion: 'gnomon-local-session:v1';
  session: string;
  cwd: string;
  /** realpath'd tool roots: cwd + worktree (default [cwd]) */
  roots: string[];
  endpoint: { base: string; model: string; compat: string };
  capabilities: { tools: boolean; nCtx: number | null };
  surface: ToolSurface;
  maxSteps: number;
  maxTokens: number;
  /** the working context target (tokens) compaction keeps the history under (§13.1 ~8k; default 8192) */
  contextTarget: number;
  forbiddenPorts: number[];
  systemPrompt?: string;
}

export class ConfigError extends Error {}

const SURFACES: readonly string[] = ['none', 'compact', 'full'];

export function parseSessionConfig(text: string): LocalSessionConfig {
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ConfigError('config is not the JSON subset of YAML');
  }
  const ep = c.endpoint as Record<string, unknown> | undefined;
  const caps = c.capabilities as Record<string, unknown> | undefined;
  if (c.schemaVersion !== 'gnomon-local-session:v1') throw new ConfigError('schemaVersion must be gnomon-local-session:v1');
  if (typeof c.session !== 'string' || typeof c.cwd !== 'string') throw new ConfigError('session and cwd are required');
  if (!ep || typeof ep.base !== 'string' || typeof ep.model !== 'string' || typeof ep.compat !== 'string') throw new ConfigError('endpoint{base, model, compat} is required');
  if (!Object.hasOwn(COMPAT_ALLOWLIST, ep.compat)) throw new ConfigError(`compat ${ep.compat.slice(0, 32)} is not in the local allowlist`);
  const forbiddenPorts = Array.isArray(c.forbiddenPorts) ? c.forbiddenPorts.filter((p): p is number => Number.isInteger(p)) : [];
  const v = classifyEndpoint(ep.base, forbiddenPorts);
  if (!v.ok) throw new ConfigError(`endpoint refused: ${v.why} (loopback/LAN only, law 7)`);
  if (!caps || typeof caps.tools !== 'boolean') throw new ConfigError('capabilities{tools} is required');
  const surface = typeof c.surface === 'string' && SURFACES.includes(c.surface) ? (c.surface as ToolSurface) : 'compact';
  const real = (p: string): string => {
    try {
      return realpathSync.native(p); // the same native canonicalisation as the tools (8.3 names on Windows)
    } catch {
      throw new ConfigError(`root ${p.slice(0, 200)} does not exist`);
    }
  };
  const rawRoots = Array.isArray(c.roots) && c.roots.length ? c.roots : [c.cwd];
  if (rawRoots.some((r) => typeof r !== 'string' || !r.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(r))) throw new ConfigError('roots must be absolute paths');
  const roots = (rawRoots as string[]).map(real);
  const int = (x: unknown, d: number, max: number): number => (Number.isInteger(x) && (x as number) > 0 ? Math.min(x as number, max) : d);
  return {
    schemaVersion: 'gnomon-local-session:v1',
    session: c.session,
    cwd: c.cwd,
    roots,
    endpoint: { base: v.base, model: ep.model, compat: ep.compat },
    capabilities: { tools: caps.tools, nCtx: typeof caps.nCtx === 'number' ? caps.nCtx : null },
    surface,
    maxSteps: int(c.maxSteps, 16, 128),
    maxTokens: int(c.maxTokens, 1024, 32768),
    contextTarget: Math.max(int(c.contextTarget, 8192, 131072), 1024),
    forbiddenPorts,
    ...(typeof c.systemPrompt === 'string' ? { systemPrompt: c.systemPrompt } : {}),
  };
}

/** Wire an agent to a line source; returns the line handler. */
export function rpcSession(cfg: LocalSessionConfig, emit: Emit): { onLine: (line: string) => void; agent: Agent } {
  const agent = new Agent({
    base: cfg.endpoint.base,
    model: cfg.endpoint.model,
    profile: COMPAT_ALLOWLIST[cfg.endpoint.compat]!,
    nativeTools: cfg.capabilities.tools,
    surface: cfg.surface,
    cwd: cfg.cwd,
    roots: cfg.roots,
    maxSteps: cfg.maxSteps,
    maxTokens: cfg.maxTokens,
    contextTarget: cfg.contextTarget,
    forbiddenPorts: cfg.forbiddenPorts,
    ...(cfg.systemPrompt !== undefined ? { systemPrompt: cfg.systemPrompt } : {}),
    emit,
  });
  emit({ type: 'model_capabilities', backend: 'local', model: cfg.endpoint.model, compat: cfg.endpoint.compat, tools: cfg.capabilities.tools, ctx: cfg.capabilities.nCtx, surface: cfg.surface, textTools: !cfg.capabilities.tools && cfg.surface !== 'none', contextTarget: cfg.contextTarget });
  const onLine = (line: string): void => {
    let cmd: Record<string, unknown>;
    try {
      cmd = JSON.parse(line) as Record<string, unknown>;
    } catch {
      emit({ type: 'response', command: 'unknown', success: false, error: 'malformed line' });
      return;
    }
    const id = typeof cmd.id === 'string' ? { id: cmd.id } : {};
    const command = typeof cmd.type === 'string' ? cmd.type : 'unknown';
    const ok = (data?: unknown): void => emit({ type: 'response', ...id, command, success: true, ...(data !== undefined ? { data } : {}) });
    const no = (error: string): void => emit({ type: 'response', ...id, command, success: false, error });
    const msg = typeof cmd.message === 'string' && cmd.message.length > 0 ? cmd.message : null;
    switch (command) {
      case 'prompt':
        if (!msg) return no('message is required');
        if (agent.running) return no('agent is busy (use steer or follow_up)');
        ok();
        void agent.prompt(msg);
        return;
      case 'steer':
        if (!msg) return no('message is required');
        agent.steer(msg);
        return ok();
      case 'follow_up':
        if (!msg) return no('message is required');
        agent.followUp(msg);
        return ok();
      case 'abort':
        agent.abort();
        return ok();
      case 'get_state':
        return ok(agent.state());
      default:
        return no(`unknown command ${command.slice(0, 32)}`);
    }
  };
  return { onLine, agent };
}
