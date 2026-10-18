/**
 * @symbol #mod-host
 *
 * #mod-host refusals (spec §3.8, §12.3). Every refusal is a contracts
 * `refusal:v1` (refuse()) carried by a RefusedError, so the socket relays
 * (`mod.view` / `mod.command`, slice 2) map it with the §4.9 code map
 * unchanged, and the mod receives the same object as its JSON-RPC error data.
 *
 * The mod-host code (`EFFECT`, `TIMEOUT`, …) rides in `refusal.data.modCode`,
 * never in `data.reason`: `refusal.reason` is an additive enum hashed into
 * clientApiId (contracts rpc.ts ADDITIVE_ENUMS), so naming new reasons there
 * would move the pinned id (the same rule #manifest-loader follows). Adding
 * these to REFUSAL_REASONS is a batch candidate for the next clientApiId move.
 */
import { refuse, RefusedError, type RefusalCode, type RefusalGate } from '@a-company/gnomon-contracts';

export const MOD_REFUSAL_CODES = [
  'EFFECT', // a call outside the mod's declared effects (or the dev-mode read cap) — §12.3 FORBIDDEN + mod.effect.refused
  'APPROVE', // `approve` through kernel.call: never proxied (§12.3)
  'VERB', // a kernel verb the mod column of §5 does not allow, or log.append outside its own modns
  'UNDECLARED', // a view / command / tool the manifest does not declare
  'PAUSED', // the mod is paused (a changed linked folder, an expired dev period) until a card decides
  'NOT_RUNNING', // no child for the mod (never started, stopped, or out of restarts)
  'ABI', // init answered another abi or another modAbiId
  'SANDBOX', // the `mod` profile cannot be applied here (fail closed, §15.5 rule)
  'TIMEOUT', // a host → mod call ran past its timeout (cancel sent; restarted if not honoured)
  'CRASHED', // the child exited with the call in flight
  'MOD_ERROR', // the mod answered the call with an error
  'BLOCK', // a rendered block outside kit:v1, or over 256 KiB / 2 000 nodes (§12.2 BAD_REQUEST)
  'STATE', // state.get/state.set outside the size caps or key shape
  'BUSY', // more than MAX_MOD_INFLIGHT mod → host requests in flight (retry later)
  'NOT_IMPLEMENTED', // a kernel.call with no kernel port wired (unit rigs; the daemon always wires one)
  'CALL', // a mod → host request echoing a callId that is not the call in force (M1.11 slice 2)
  'LOG', // a log.append through kernel.call whose payload is not an object or exceeds the cap (Aegis C2)
] as const;
export type ModRefusalCode = (typeof MOD_REFUSAL_CODES)[number];

const ROUTE: Record<ModRefusalCode, { code: RefusalCode; gate: RefusalGate }> = {
  EFFECT: { code: 'FORBIDDEN', gate: 'trust' },
  APPROVE: { code: 'FORBIDDEN', gate: 'trust' },
  VERB: { code: 'FORBIDDEN', gate: 'trust' },
  UNDECLARED: { code: 'NOT_FOUND', gate: 'usage' },
  PAUSED: { code: 'FORBIDDEN', gate: 'trust' },
  NOT_RUNNING: { code: 'ENGINE', gate: 'transport' },
  ABI: { code: 'UNSUPPORTED', gate: 'usage' },
  SANDBOX: { code: 'UNSUPPORTED', gate: 'usage' },
  TIMEOUT: { code: 'ENGINE', gate: 'transport' },
  CRASHED: { code: 'ENGINE', gate: 'transport' },
  MOD_ERROR: { code: 'ENGINE', gate: 'transport' },
  BLOCK: { code: 'BAD_REQUEST', gate: 'usage' },
  STATE: { code: 'BAD_REQUEST', gate: 'usage' },
  BUSY: { code: 'ENGINE', gate: 'transport' },
  NOT_IMPLEMENTED: { code: 'ENGINE', gate: 'transport' },
  CALL: { code: 'FORBIDDEN', gate: 'trust' },
  LOG: { code: 'BAD_REQUEST', gate: 'usage' },
};

export class ModRefusal extends RefusedError {
  readonly modCode: ModRefusalCode;
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(modCode: ModRefusalCode, message: string, detail: Record<string, unknown> = {}) {
    const r = ROUTE[modCode];
    super(refuse({ code: r.code, gate: r.gate, data: { modCode, ...detail } }), `#mod-host: ${message}`);
    this.name = 'ModRefusal';
    this.modCode = modCode;
    this.detail = Object.freeze({ ...detail });
  }
}

export function isModRefusal(err: unknown): err is ModRefusal {
  return err instanceof ModRefusal;
}
