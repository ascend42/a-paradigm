/**
 * @symbol #socket
 *
 * #socket (spec §5) — the method registry: every `gnomon-rpc:v1` method
 * DECLARES a permission tier for every matrix class, and the default is deny.
 *
 * Orca's registry refuses a method without a tier, but its caller-scope check
 * still fails OPEN on `permission === undefined` (Orca audit Adopt 4). Here
 * both ends are closed:
 *   - register() throws unless the method names a tier for EVERY class
 *     (`false` = refused, or a non-empty access string from §5's matrix) and
 *     no other key; a duplicate or empty method name throws too;
 *   - tier() answers `false` for an unknown method, an unknown class, and any
 *     stored tier that is not `false` or a non-empty string (an undefined
 *     slipped past registration is DENY, never "no restriction").
 *
 * The kernel registry is built once, at module load, from the contracts'
 * frozen VERBS + CLIENT_RELAYS; a descriptor with a missing tier fails the
 * daemon's start, not a call.
 *
 * `hello` and `auth` are NOT in this registry: they are the pre-auth
 * handshake, outside the tier registry. dispatch.ts handles them before any
 * registry lookup (no matrix class exists until auth names a principal), and
 * before auth every other name is refused AUTH without consulting the registry.
 */
import { CLIENT_RELAYS, HUMAN_DEVICE_VERBS, VERBS, type Access, type VerbDescriptor } from '@a-company/gnomon-contracts';

export type MatrixClass = keyof VerbDescriptor['access'];

/** The §5 matrix columns, in order. */
export const MATRIX_CLASSES: readonly MatrixClass[] = Object.freeze(['human', 'agent', 'session', 'mod', 'voice', 'readToken', 'peer'] as const);

export type MethodTiers = Readonly<Record<MatrixClass, Access>>;

export interface MethodRegistration {
  method: string;
  kind: 'verb' | 'relay';
  tiers: MethodTiers;
}

export class MethodRegistrationError extends Error {
  constructor(method: unknown, why: string) {
    super(`gnomon-rpc method ${JSON.stringify(typeof method === 'string' ? method.slice(0, 64) : String(method))} cannot be registered: ${why}`);
    this.name = 'MethodRegistrationError';
  }
}

function validTier(v: unknown): v is Access {
  return v === false || (typeof v === 'string' && v.length > 0);
}

export class MethodRegistry {
  private readonly methods = new Map<string, MethodRegistration>();
  private sealed = false;

  register(r: MethodRegistration): this {
    if (this.sealed) throw new MethodRegistrationError(r?.method, 'the registry is sealed');
    if (!r || typeof r.method !== 'string' || r.method.length === 0) throw new MethodRegistrationError(r?.method, 'a method needs a non-empty name');
    if (r.kind !== 'verb' && r.kind !== 'relay') throw new MethodRegistrationError(r.method, 'kind must be verb or relay');
    if (this.methods.has(r.method)) throw new MethodRegistrationError(r.method, 'already registered');
    const t = r.tiers as unknown;
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new MethodRegistrationError(r.method, 'no permission tiers declared (default is deny; declare false explicitly)');
    const tiers = t as Record<string, unknown>;
    for (const cls of MATRIX_CLASSES) {
      if (!Object.hasOwn(tiers, cls)) throw new MethodRegistrationError(r.method, `no permission tier for the ${cls} class`);
      if (!validTier(tiers[cls])) throw new MethodRegistrationError(r.method, `the ${cls} tier must be false or a non-empty access string`);
    }
    for (const k of Object.keys(tiers)) if (!(MATRIX_CLASSES as readonly string[]).includes(k)) throw new MethodRegistrationError(r.method, `unknown matrix class ${k}`);
    const tierCopy = Object.freeze(Object.fromEntries(MATRIX_CLASSES.map((c) => [c, tiers[c] as Access]))) as MethodTiers;
    this.methods.set(r.method, Object.freeze({ method: r.method, kind: r.kind, tiers: tierCopy }));
    return this;
  }

  /** No more registrations (the kernel registry is sealed at module load). */
  seal(): this {
    this.sealed = true;
    return this;
  }

  has(method: string): boolean {
    return this.methods.has(method);
  }

  kindOf(method: string): 'verb' | 'relay' | undefined {
    return this.methods.get(method)?.kind;
  }

  /** The caller-scope check. FAILS CLOSED: anything but a declared `false` or non-empty string is `false`. */
  tier(method: string, cls: string): Access {
    const r = this.methods.get(method);
    if (!r) return false;
    if (!(MATRIX_CLASSES as readonly string[]).includes(cls)) return false;
    const v: unknown = (r.tiers as Record<string, unknown>)[cls];
    return validTier(v) ? v : false;
  }

  names(): string[] {
    return [...this.methods.keys()];
  }

  /**
   * TEST SEAM ONLY: a fresh, SEALED registry whose stored tiers skip register()'s validation, so a test can prove
   * tier() and the dispatcher fail closed on a malformed entry that slipped past registration. Never used by the
   * kernel (KERNEL_METHODS comes from buildKernelMethodRegistry).
   */
  static uncheckedForTests(entries: Iterable<{ method: string; kind?: 'verb' | 'relay'; tiers: Record<string, unknown> }>): MethodRegistry {
    const reg = new MethodRegistry();
    for (const e of entries) reg.methods.set(e.method, { method: e.method, kind: e.kind ?? 'verb', tiers: e.tiers as unknown as MethodTiers });
    return reg.seal();
  }
}

/** The relays run under the caller's principal for every class but peers and read tokens (§5 "Client relays"). */
export const RELAY_TIERS: MethodTiers = Object.freeze({
  human: 'caller principal',
  agent: 'caller principal',
  session: 'caller principal',
  mod: 'caller principal',
  voice: 'caller principal',
  readToken: false,
  peer: false,
});

/** Build the kernel's registry from the contracts' descriptors (throws on a descriptor with a missing tier). */
export function buildKernelMethodRegistry(): MethodRegistry {
  const r = new MethodRegistry();
  for (const v of VERBS) r.register({ method: v.verb, kind: 'verb', tiers: v.access });
  // P8-D98: the human-device verbs (gui.open, rules.revoke) — human tier only, every other class declared false
  for (const v of HUMAN_DEVICE_VERBS) r.register({ method: v.verb, kind: 'verb', tiers: v.access });
  for (const rel of CLIENT_RELAYS) r.register({ method: rel.relay, kind: 'relay', tiers: RELAY_TIERS });
  return r.seal();
}

/** The kernel's registry: exactly the 12 verbs + 3 human-device verbs + 2 relays, sealed. */
export const KERNEL_METHODS: MethodRegistry = buildKernelMethodRegistry();
