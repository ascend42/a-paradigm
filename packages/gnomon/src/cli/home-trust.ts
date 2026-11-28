/**
 * @symbol #mod-cli
 *
 * `homeTrust`: the root that signs a home's registry and grant table, read from the home. A LEAF module: it was
 * inside mod-cli.ts, and the agent client (`src/agent/index.ts`) imported it from there, which pulled the whole
 * CLI, the daemon, `WebEndpoint` and the embedded GUI bundle into `dist/agent.js`. It lives here so a client that
 * needs only the trust root does not import a verb family. mod-cli.ts re-exports it; nothing else changed.
 *
 * KEEP IT A LEAF: no import of a `*-cli.ts` verb family, `kernel/lifecycle/daemon.ts`, `kernel/lifecycle/index.ts`
 * (the barrel re-exports the daemon) or anything under `kernel/web/`. test/agent-entry-fence.test.ts fails if the
 * agent entry's import closure reaches `kernel/web/` again.
 */
import { RootVerifier } from '../kernel/identity/root-authority.js';
import type { RowVerifier } from '../kernel/identity/registry.js';
import { readIdentity } from '../kernel/identity/provision.js';
import { isDevHome, loadDevHome } from './dev-home.js';

const NO_TRUST: RowVerifier = Object.freeze({ rootKeyId: null, ns: null, verifyRow: () => false });

/** The root that signs this home's grant table, read from the home (never asserted by the caller). */
export function homeTrust(home: string): RowVerifier {
  try {
    const id = readIdentity(home);
    if (id) return new RootVerifier(id.rootPublicKeyPem);
  } catch {
    return NO_TRUST;
  }
  try {
    if (isDevHome(home)) return loadDevHome(home).root;
  } catch {
    return NO_TRUST;
  }
  return NO_TRUST;
}
