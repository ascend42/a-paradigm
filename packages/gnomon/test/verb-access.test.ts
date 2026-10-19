/**
 * #socket (spec §5) — every gnomon-rpc:v1 method declares a permission tier
 * for every matrix class, enforced at REGISTRATION, and the caller-scope check
 * fails CLOSED on an undefined permission (T-2026-10-19-009 item 4, Orca audit
 * Adopt 4: Orca's rpc-caller-scope.ts fails open on `permission === undefined`).
 */
import { describe, expect, it } from 'vitest';
import { CLIENT_METHODS, VERBS } from '@a-company/gnomon-contracts';
import {
  accessOf,
  buildKernelMethodRegistry,
  createKernelDispatcher,
  KERNEL_METHODS,
  MATRIX_CLASSES,
  MethodRegistrationError,
  MethodRegistry,
  RpcRefusal,
  type MethodTiers,
} from '../src/kernel/socket/index.js';

const ALL_DENY: MethodTiers = { human: false, agent: false, session: false, mod: false, voice: false, readToken: false, peer: false };

/** Plant a stored tier that never went through register() (what a fail-open check would let through). */
function plant(reg: MethodRegistry, method: string, tiers: Record<string, unknown>): void {
  (reg as unknown as { methods: Map<string, unknown> }).methods.set(method, { method, kind: 'verb', tiers });
}

function dispatcher(methods?: MethodRegistry) {
  return createKernelDispatcher({
    authenticator: {} as never, // callAs never authenticates
    status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: 'k', custody: 'partial', source: 'test' }), root: () => ({ state: 'dev-test', rootKeyId: null }) },
    log: async () => undefined,
    ...(methods ? { methods } : {}),
  });
}

async function refusalOf(p: Promise<unknown>): Promise<{ code: string; reason: unknown }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RpcRefusal) return { code: e.refusal.code, reason: e.refusal.data?.reason };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('§5: every method declares a tier at registration (default deny)', () => {
  it('the kernel registry is exactly the 12 verbs + 2 relays, every class declared', () => {
    expect(KERNEL_METHODS.names().sort()).toEqual([...CLIENT_METHODS].sort());
    for (const m of KERNEL_METHODS.names()) for (const c of MATRIX_CLASSES) expect(KERNEL_METHODS.tier(m, c) === false || typeof KERNEL_METHODS.tier(m, c) === 'string').toBe(true);
    for (const v of VERBS) for (const c of MATRIX_CLASSES) expect(KERNEL_METHODS.tier(v.verb, c)).toEqual(v.access[c]);
    expect(KERNEL_METHODS.tier('mod.view', 'readToken')).toBe(false);
    expect(KERNEL_METHODS.tier('mod.view', 'peer')).toBe(false);
    expect(KERNEL_METHODS.tier('mod.view', 'human')).toBe('caller principal');
    expect(() => buildKernelMethodRegistry()).not.toThrow();
  });

  it('FALSIFIER: registering a method without a tier throws', () => {
    const r = new MethodRegistry();
    expect(() => r.register({ method: 'x.none', kind: 'verb' } as never)).toThrow(MethodRegistrationError);
    expect(() => r.register({ method: 'x.null', kind: 'verb', tiers: null } as never)).toThrow(/no permission tiers declared/);
    const { peer: _omit, ...missingPeer } = ALL_DENY;
    expect(() => r.register({ method: 'x.missing', kind: 'verb', tiers: missingPeer as never })).toThrow(/no permission tier for the peer class/);
    expect(() => r.register({ method: 'x.undef', kind: 'verb', tiers: { ...ALL_DENY, human: undefined } as never })).toThrow(/human tier must be false or a non-empty/);
    expect(() => r.register({ method: 'x.empty', kind: 'verb', tiers: { ...ALL_DENY, agent: '' } })).toThrow(/agent tier/);
    expect(() => r.register({ method: 'x.true', kind: 'verb', tiers: { ...ALL_DENY, agent: true } as never })).toThrow(/agent tier/);
    expect(() => r.register({ method: 'x.extra', kind: 'verb', tiers: { ...ALL_DENY, root: 'yes' } as never })).toThrow(/unknown matrix class root/);
    expect(() => r.register({ method: '', kind: 'verb', tiers: ALL_DENY })).toThrow(/non-empty name/);
    expect(r.names()).toEqual([]); // nothing half-registered
    r.register({ method: 'x.ok', kind: 'verb', tiers: ALL_DENY });
    expect(() => r.register({ method: 'x.ok', kind: 'verb', tiers: ALL_DENY })).toThrow(/already registered/);
    r.seal();
    expect(() => r.register({ method: 'x.late', kind: 'verb', tiers: ALL_DENY })).toThrow(/sealed/);
    expect(() => KERNEL_METHODS.register({ method: 'x.kernel', kind: 'verb', tiers: ALL_DENY })).toThrow(/sealed/);
  });

  it('FALSIFIER: the caller-scope check fails CLOSED on an undefined permission, an unknown method or class', () => {
    const r = new MethodRegistry();
    plant(r, 'x.planted', { human: undefined, agent: 'yes' });
    expect(r.tier('x.planted', 'human')).toBe(false); // Orca: undefined ⇒ allowed; here ⇒ denied
    expect(r.tier('x.planted', 'session')).toBe(false); // key absent
    expect(r.tier('x.planted', 'agent')).toBe('yes');
    expect(r.tier('x.unknown', 'human')).toBe(false);
    expect(KERNEL_METHODS.tier('status', 'kernel')).toBe(false);
    expect(KERNEL_METHODS.tier('status', '__proto__')).toBe(false);
    expect(accessOf('no.such.verb', 'human')).toBe(false);
  });

  it('FALSIFIER: the dispatcher refuses FORBIDDEN{matrix} before any handler when a tier is undefined', async () => {
    // control: the kernel registry lets a mod reach ref.resolve's handler (no read side here ⇒ ENGINE not-implemented)
    expect(await refusalOf(dispatcher().callAs('p:ns/mod-a', 'ref.resolve', { ref: 'x' }))).toEqual({ code: 'ENGINE', reason: 'not-implemented' });
    // the same call with the mod tier undefined never reaches the handler
    const r = new MethodRegistry();
    for (const m of KERNEL_METHODS.names()) {
      const tiers = Object.fromEntries(MATRIX_CLASSES.map((c) => [c, KERNEL_METHODS.tier(m, c)]));
      if (m === 'ref.resolve') tiers.mod = undefined as never;
      plant(r, m, tiers);
    }
    expect(await refusalOf(dispatcher(r).callAs('p:ns/mod-a', 'ref.resolve', { ref: 'x' }))).toEqual({ code: 'FORBIDDEN', reason: 'matrix' });
  });
});
