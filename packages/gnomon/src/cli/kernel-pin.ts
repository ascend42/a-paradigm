/**
 * @symbol $daemon-lifecycle
 *
 * `kernelPinOf`: the server-key pin every client takes from the HOME before it authenticates (T-2026-10-19-016(a)).
 * A LEAF module: it was inside daemon-cli.ts, and the agent client (`src/agent/index.ts`) imported it from there,
 * which pulled the daemon, `WebEndpoint` and the embedded GUI bundle into `dist/agent.js`. daemon-cli.ts re-exports
 * it, so every `*-cli.ts` caller is unchanged.
 *
 * KEEP IT A LEAF: the identity modules are imported by file (not through a barrel that could grow), and nothing
 * here imports a `*-cli.ts` verb family, the daemon or anything under `kernel/web/`
 * (test/agent-entry-fence.test.ts).
 */
import { readKernelPubs } from '../kernel/identity/kernel-pub.js';
import { readRegistry } from '../kernel/identity/registry.js';
import type { ServerKeyPin } from '../kernel/socket/client.js';
import { homeTrust } from './home-trust.js';

/**
 * The pin for `keyId`, read from the home (never from the server): the
 * root-signed registry first, else the home's same-user kernel-pub.jsonl.
 */
export function kernelPinOf(home: string, keyId: string): { pin: ServerKeyPin; source: 'registry' | 'home-kernel-pub' } | null {
  if (typeof keyId !== 'string' || keyId === '') return null;
  try {
    const pem = readRegistry(home, homeTrust(home)).kernelKeys.get(keyId);
    if (pem) return { pin: { keyId, publicKeyPem: pem }, source: 'registry' };
  } catch {
    /* no registry: fall through */
  }
  const pub = readKernelPubs(home).find((k) => k.keyId === keyId);
  return pub ? { pin: { keyId, publicKeyPem: pub.publicKeyPem }, source: 'home-kernel-pub' } : null;
}
