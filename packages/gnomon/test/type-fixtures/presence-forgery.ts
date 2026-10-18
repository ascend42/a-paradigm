/**
 * Type fixture for test/presence.test.ts (T-2026-10-17-009(c)): every forgery
 * below must be a TYPE ERROR. Compiled by the test with the TypeScript API;
 * an unused `@ts-expect-error` (a forgery that type-checks) fails it.
 * Not a vitest file (no `.test.ts`), never imported at runtime.
 */
import { KernelLog } from '../../src/kernel/log/index.js';
import { PresenceToken } from '../../src/kernel/identity/presence.js';
import { acknowledgeGap, mintTestPresence } from '../../src/kernel/testing.js';

declare const log: KernelLog;

// the one legal source in tests
export const ok: PresenceToken = mintTestPresence();

// @ts-expect-error a string is not presence
export const s: PresenceToken = 'stub-presence';

// @ts-expect-error a structurally identical object literal is not presence
export const o: PresenceToken = { purpose: 'log.gap.acknowledge', method: 'test-seam', mintedAt: 0 };

class Fake {
  readonly purpose = 'log.gap.acknowledge' as const;
  readonly method = 'test-seam' as const;
  readonly mintedAt = 0;
}
// @ts-expect-error a look-alike class is not presence (private #state + unique symbol brand)
export const f: PresenceToken = new Fake();

// @ts-expect-error the constructor is private to the presence module
export const n = new PresenceToken(Symbol() as never, 'log.gap.acknowledge', 'test-seam', 0);

// @ts-expect-error acknowledgeGap takes a PresenceToken, not a string
export const g = acknowledgeGap(log, { presenceToken: 'stub-presence' });

// @ts-expect-error the public KernelLog has no recovery open
export const r = KernelLog.openForRecovery;

// @ts-expect-error the public KernelLog has no acknowledgeGap
export const a = log.acknowledgeGap;

// @ts-expect-error keystoreAnchor is not a public KernelLogOptions key
KernelLog.open({ home: '/x', kernelPrincipal: 'p:x/kernel', signer: null, keystoreAnchor: undefined });
