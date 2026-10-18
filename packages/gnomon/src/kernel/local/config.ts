/**
 * @symbol #local-runner
 * @symbol ^subscription-only
 *
 * The local lane's configuration (spec §13.1 `local.yaml`, §3.3 argv). The
 * kernel validates it on EVERY local open, fail closed:
 *   - an endpoint outside loopback/LAN (kernel/local/endpoint.ts) refuses the
 *     whole lane BILLING_REFUSED (G-SUB-06: a poisoned config is not "use the
 *     other endpoints");
 *   - a compat profile outside the local allowlist refuses BILLING_REFUSED
 *     too (cloud providers are not in the build, §13.1);
 *   - the runner command is the gnomon-local executable: a command or
 *     argument whose basename is `claude` is refused PERMIT_REQUIRED — law 7
 *     never lets `claude` run under a backend:'local' permit (S8's mirror).
 *
 * SLICE 1 READING (reported): the config is passed in-process (supervisor
 * options); reading a ROOT-SIGNED `local.yaml` from the Gnomon home and its
 * signature check are slice 2. The per-session file the kernel hands the
 * child is written as JSON (the JSON subset of YAML 1.2).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { refuse, RefusedError } from '@a-company/gnomon-contracts';
import { classifyEndpoint, type EndpointVerdict } from './endpoint.js';

/** The local transports the child's compat allowlist names (no cloud provider; parity-tested against gnomon-local). */
export const LOCAL_COMPAT_NAMES = Object.freeze(['llama.cpp', 'ollama', 'lm-studio', 'vllm', 'mlx-lm']);

export type ToolSurface = 'none' | 'compact' | 'full';

export interface LocalEndpointConfig {
  id: string;
  base: string;
  /** the model id to request (the probe's /v1/models id wins when present) */
  model: string;
  compat: string;
  surface?: ToolSurface;
  /** opt this model into the text-tool fallback when the probe finds no native tool calls (§13.1) */
  textTools?: boolean;
}

export interface LocalRunnerCommand {
  /** absolute path of the executable (node, or a gnomon-local binary) */
  command: string;
  /** leading args (e.g. the gnomon-local dist/cli.js) */
  args?: string[];
}

export interface LocalLaneConfig {
  endpoints: LocalEndpointConfig[];
  /** the gnomon-local runner; absent ⇒ the lane can route and raise fallback cards but never spawns */
  runner?: LocalRunnerCommand;
  /** the task floor for n_ctx (§13.3 "ctx ≥ task floor"; default 8192, the ~8k working target) */
  ctxFloor?: number;
  maxSteps?: number;
  maxTokens?: number;
}

export const DEFAULT_CTX_FLOOR = 8192;

function refused(code: 'BILLING_REFUSED' | 'PERMIT_REQUIRED', message: string, data: Record<string, unknown>): RefusedError {
  return new RefusedError(refuse({ code, data }), `#local-runner: ${message}`);
}

/** Validate every endpoint (G-SUB-06) and the compat names; returns the classified endpoints. */
export function validateLocalEndpoints(cfg: LocalLaneConfig, forbiddenPorts: readonly number[]): Array<{ ep: LocalEndpointConfig; v: Extract<EndpointVerdict, { ok: true }> }> {
  const out: Array<{ ep: LocalEndpointConfig; v: Extract<EndpointVerdict, { ok: true }> }> = [];
  for (const ep of cfg.endpoints) {
    const v = classifyEndpoint(ep.base, forbiddenPorts);
    if (!v.ok) throw refused('BILLING_REFUSED', `local endpoint ${ep.id} refused: ${v.why} (loopback/LAN only, law 7)`, { dimension: 'local-endpoint', endpoint: ep.id, why: v.why });
    if (!LOCAL_COMPAT_NAMES.includes(ep.compat)) throw refused('BILLING_REFUSED', `compat ${String(ep.compat).slice(0, 32)} is not a local transport`, { dimension: 'local-compat', endpoint: ep.id, why: 'compat' });
    out.push({ ep, v });
  }
  return out;
}

const CLAUDE_NAME = /^claude(\.exe|\.cmd|\.js|\.mjs)?$/i;

const real = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

/**
 * Law 7 / S8 mirror: the local runner is never `claude` — by command or any argument, checked on the path AS
 * GIVEN and on its REALPATH (a symlink named gnomon-local pointing at claude is refused), and any path with an
 * `@anthropic-ai/claude-code` segment (Aegis L3). Slice 2: a positive pin of the runner (hash, like the claude pin).
 */
export function assertNotClaude(r: LocalRunnerCommand): void {
  for (const p of [r.command, ...(r.args ?? [])].flatMap((x) => [x, real(x)])) {
    if (CLAUDE_NAME.test(path.basename(p)) || /(^|[\\/])claude-[0-9a-f]{16,}$/i.test(p) || /(^|[\\/])@anthropic-ai[\\/]claude-code([\\/]|$)/i.test(p)) {
      throw refused('PERMIT_REQUIRED', 'claude never runs under a backend:local permit (law 7, S8)', { why: 'claude-under-local-permit' });
    }
  }
  if (!path.isAbsolute(r.command)) throw refused('PERMIT_REQUIRED', 'the local runner is resolved by absolute path, never PATH', { why: 'runner-not-absolute' });
}
