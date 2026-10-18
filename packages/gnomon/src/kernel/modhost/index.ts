/**
 * @symbol #mod-host
 *
 * #mod-host public surface (spec §3.8, §12; M1.11 slice 1). The unsandboxed
 * launcher and the egress dialer are NOT here: they are test seams only
 * (kernel/testing.ts createModHostForTest).
 */
export { ModHost, MOD_ENTRIES, DEFAULT_CALL_TIMEOUT_MS, DEFAULT_CANCEL_GRACE_MS, RESTART_CAP } from './host.js';
export type { ModHostOptions, ModChildrenPort, KernelCallRequest, ModStartResult, RenderResult, CallOptions } from './host.js';
export { ModRefusal, isModRefusal, MOD_REFUSAL_CODES } from './refusal.js';
export type { ModRefusalCode } from './refusal.js';
export { declaredEffects, effectsFor, verbEffect, methodEffect } from './effects.js';
export type { CallContext } from './effects.js';
export { sanitizeModBlock } from './block.js';
export { EgressProxy, EGRESS_PORTS, isNonPublicAddress } from './egress-proxy.js';
export { ModState, STATE_LIMITS, stateDir, blobsDir } from './state.js';
export { ModChannel, MOD_FRAME_MAX_BYTES } from './channel.js';
