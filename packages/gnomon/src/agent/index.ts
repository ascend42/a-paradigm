/**
 * @symbol #gnomon-ts-client
 * @symbol #loop-agent-ops
 *
 * `@a-company/gnomon/agent`: the agent principal's door to the kernel's loop ops (docs/specs/gnomon-loops.md §5;
 * build plan step 12). paradigm-mcp's `paradigm_loop` kernel ops call `loopRequest()`, which:
 *   1. resolves the Gnomon home and its endpoint (the same rules as every client);
 *   2. loads the AGENT device key: `GNOMON_AGENT_KEY` (an absolute path) or `<home>/agent/device.key`, which must
 *      have a root-signed registry row of principal kind `agent` (a human key is never used for an agent);
 *   3. probes the kernel, pins its key from the home's registry (nothing is sent to an unregistered server), then
 *      authenticates and appends `loop.request{op, …}`. The kernel stamps the principal and hsid from the
 *      connection; this client sends neither.
 * No kernel, no endpoint or no agent key: `LoopKernelUnavailable` with a `why` the tool shows ("needs Gnomon
 * running"). A kernel refusal comes back as `{refused: {code, reason, message}}`, never a throw.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { refusalOf } from '@a-company/gnomon-contracts';
import { kernelPinOf } from '../cli/daemon-cli.js';
import { homeTrust } from '../cli/mod-cli.js';
import { loadDeviceCredential, readRegistry } from '../kernel/identity/index.js';
import { resolveGnomonHome, selectSocketPath } from '../kernel/lifecycle/index.js';
import { connectGnomon, type DeviceCredential } from '../kernel/socket/index.js';
import { GNOMON_VERSION } from '../version.js';

export const AGENT_KEY_ENV = 'GNOMON_AGENT_KEY';

export class LoopKernelUnavailable extends Error {
  constructor(readonly why: 'no-endpoint' | 'not-running' | 'no-agent-key' | 'unverified-server', message: string) {
    super(message);
    this.name = 'LoopKernelUnavailable';
  }
}

export interface LoopRequestOptions {
  home?: string;
  env?: Readonly<Record<string, string | undefined>>;
  /** the client name in hello (default paradigm-mcp) */
  clientName?: string;
}

/** The agent's device credential from the home, or why there is none. */
export function agentDeviceOf(home: string, env: Readonly<Record<string, string | undefined>> = process.env): DeviceCredential | string {
  const named = env[AGENT_KEY_ENV];
  if (named !== undefined && named !== '' && !path.isAbsolute(named)) return `${AGENT_KEY_ENV} must be an absolute path`;
  const file = named ? named : path.join(home, 'agent', 'device.key');
  // Aegis: the agent key lives inside the Gnomon home (realpath, so a symlink out is refused too)
  try {
    const realHome = fs.realpathSync.native(home);
    const real = fs.realpathSync.native(file);
    const rel = path.relative(realHome, real);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return `the agent key must be inside the Gnomon home (${realHome})`;
  } catch {
    return `no agent key at ${file}`;
  }
  let signer;
  try {
    signer = loadDeviceCredential(home, file).signer;
  } catch (e) {
    return `no agent key loads (${(e as Error).message})`;
  }
  const row = [...readRegistry(home, homeTrust(home)).devices.values()].find((d) => d.keyId === signer.keyId);
  if (!row || row.principalKind !== 'agent') return 'the agent key has no root-signed agent registry row in the home';
  return { principalId: row.principalId, deviceId: row.deviceId, signer };
}

/** Append one `loop.request{op, …}` as the agent principal; the kernel's answer, or `{refused}`. */
export async function loopRequest(payload: Record<string, unknown>, o: LoopRequestOptions = {}): Promise<Record<string, unknown>> {
  const env = o.env ?? process.env;
  const home = path.resolve(o.home ?? resolveGnomonHome({ env }));
  const sock = selectSocketPath({ home, env });
  if (!sock.ok) throw new LoopKernelUnavailable('no-endpoint', `needs Gnomon running: no safe endpoint for ${home}`);
  const device = agentDeviceOf(home, env);
  if (typeof device === 'string') throw new LoopKernelUnavailable('no-agent-key', `needs Gnomon running with an agent key: ${device}`);
  const client = { name: o.clientName ?? 'paradigm-mcp', version: GNOMON_VERSION, surface: 'cli' as const };
  let probe;
  try {
    probe = await connectGnomon({ socketPath: sock.path, client });
  } catch (e) {
    throw new LoopKernelUnavailable('not-running', `needs Gnomon running (${(e as Error).message.slice(0, 160)})`);
  }
  await probe.conn.close();
  const found = kernelPinOf(home, probe.hello.serverKeyId);
  if (!found) throw new LoopKernelUnavailable('unverified-server', 'the key this server names is not registered in the home: nothing was sent to it');
  const s = await connectGnomon({ socketPath: sock.path, client, serverKey: found.pin, device });
  try {
    const r = await s.conn.call('log.append', { kind: 'loop.request', payload });
    if ('error' in r) {
      const data = refusalOf(r);
      return { refused: { code: data?.code ?? 'ENGINE', reason: String(data?.data?.reason ?? 'refused'), message: r.error.message } };
    }
    return (r.result ?? {}) as Record<string, unknown>;
  } finally {
    await s.conn.close();
  }
}
