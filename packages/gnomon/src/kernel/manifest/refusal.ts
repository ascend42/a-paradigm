/**
 * @symbol #manifest-loader
 *
 * #manifest-loader refusals (spec §3.6, §4.6, §12.5). Every refusal is a
 * contracts `refusal:v1` (refuse()) carried by a RefusedError, so the socket
 * maps it with the §4.9 code map unchanged.
 *
 * The manifest-specific code (`SNAPSHOT`, `LOCKFILE`, …) rides in
 * `refusal.data.manifestCode`, the same token the `manifest.refuse{code}`
 * event carries (§12.5: `manifest.refuse{code:'SNAPSHOT'}`). It is NOT put in
 * `data.reason`: `refusal.reason` is an additive enum hashed into
 * `clientApiId` (contracts rpc.ts ADDITIVE_ENUMS), so naming new reasons there
 * would move the pinned id. For the same reason no detail key is named
 * `reason` (strict refusal:v1 validation checks `data.reason` against that enum). Adding these codes to REFUSAL_REASONS is a batch
 * candidate for the next clientApiId move (reported in the M1.5 hand-off).
 */
import { refuse, RefusedError, type RefusalCode, type RefusalGate } from '@a-company/gnomon-contracts';

/** Manifest refusal codes (kernel-internal; `manifest.refuse{code}` and `refusal.data.manifestCode`). */
export const MANIFEST_REFUSAL_CODES = [
  'SCHEMA', // manifest:v1 shape (types, closed keys, slots, keybindings, …)
  'ABI', // kind: mod without abi, or an unknown abi
  'NAME', // name collides with a kernel namespace token
  'TIER', // kind adapter/provider, or a first-party-only capability, outside the first-party tier
  'CAPABILITY', // unknown capability form, kernel-owned kind, or a grant-derived-only capability
  'EGRESS', // Anthropic API host in egress, or egress together with provides.knowledge
  'KNOWLEDGE', // provides.knowledge without knowledge:provide, or a provider shipping more than knowledge
  'SNAPSHOT', // the snapshot copier refused a path (symlink, junction, hardlink, .node, escape, …)
  'LOCKFILE', // node_modules without a (parseable npm) lockfile
  'POSTINSTALL', // package lifecycle install scripts (no postinstall anywhere)
  'GRANT', // a capability or egress host the grant table does not hold
  'INTEGRITY', // a pinned snapshot no longer hashes to its packageHash
  'GENERATED', // a generated-file target is not ours (never overwrite a user file)
  'NOT_INSTALLED', // no effective grant.install for the mod
] as const;
export type ManifestRefusalCode = (typeof MANIFEST_REFUSAL_CODES)[number];

const ROUTE: Record<ManifestRefusalCode, { code: RefusalCode; gate: RefusalGate }> = {
  SCHEMA: { code: 'BAD_REQUEST', gate: 'usage' },
  ABI: { code: 'UNSUPPORTED', gate: 'usage' },
  NAME: { code: 'BAD_REQUEST', gate: 'usage' },
  TIER: { code: 'FORBIDDEN', gate: 'trust' },
  CAPABILITY: { code: 'FORBIDDEN', gate: 'trust' },
  EGRESS: { code: 'FORBIDDEN', gate: 'trust' },
  KNOWLEDGE: { code: 'BAD_REQUEST', gate: 'usage' },
  SNAPSHOT: { code: 'FORBIDDEN', gate: 'trust' },
  LOCKFILE: { code: 'BAD_REQUEST', gate: 'usage' },
  POSTINSTALL: { code: 'FORBIDDEN', gate: 'trust' },
  GRANT: { code: 'FORBIDDEN', gate: 'trust' },
  INTEGRITY: { code: 'INTEGRITY_BROKEN', gate: 'trust' },
  GENERATED: { code: 'FORBIDDEN', gate: 'usage' },
  NOT_INSTALLED: { code: 'NOT_FOUND', gate: 'usage' },
};

export class ManifestRefusal extends RefusedError {
  readonly manifestCode: ManifestRefusalCode;
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(manifestCode: ManifestRefusalCode, message: string, detail: Record<string, unknown> = {}) {
    const r = ROUTE[manifestCode];
    super(refuse({ code: r.code, gate: r.gate, data: { manifestCode, ...detail } }), `#manifest-loader: ${message}`);
    this.name = 'ManifestRefusal';
    this.manifestCode = manifestCode;
    this.detail = Object.freeze({ ...detail });
  }
}

export function isManifestRefusal(err: unknown): err is ManifestRefusal {
  return err instanceof ManifestRefusal;
}

/** The kernel event sink (§9.1 kinds; the caller appends them to #kernel-log). */
export type ManifestEventSink = (kind: string, payload: Record<string, unknown>) => void;

export const noEvents: ManifestEventSink = () => undefined;
