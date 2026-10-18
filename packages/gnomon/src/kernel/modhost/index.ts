/**
 * @symbol #mod-host
 *
 * #mod-host public surface (spec §3.8, §12; M1.11 slices 1–2). The unsandboxed
 * launcher and the egress dialer are NOT here: they are test seams only
 * (kernel/testing.ts createModHostForTest).
 */
export { ModHost, MOD_ENTRIES, DEFAULT_CALL_TIMEOUT_MS, DEFAULT_CANCEL_GRACE_MS, RESTART_CAP, FOLDER_DEBOUNCE_MS, MAX_MOD_HOST_INFLIGHT, RELAY_MISS_ROWS_PER_WINDOW, RELAY_MISS_WINDOW_MS } from './host.js';
export { createModKernelCall, createModRelayPort, clampModAppend, MOD_APPEND_MAX_BYTES, MOD_APPEND_FIELDS, MOD_APPEND_ROWS_PER_SEC, MOD_APPEND_BYTES_PER_CALL } from './bridge.js';
export type { ModKernelPorts, ModRelays, ModAppendRow } from './bridge.js';
export type { ModHostOptions, ModChildrenPort, KernelCallRequest, ModStartResult, RenderResult, CallOptions } from './host.js';
export { ModRefusal, isModRefusal, MOD_REFUSAL_CODES } from './refusal.js';
export type { ModRefusalCode } from './refusal.js';
export { declaredEffects, effectsFor, verbEffect, methodEffect } from './effects.js';
export type { CallContext } from './effects.js';
export { sanitizeModBlock } from './block.js';
export { EgressProxy, EGRESS_PORTS, isNonPublicAddress } from './egress-proxy.js';
export { ModState, STATE_LIMITS, stateDir, blobsDir } from './state.js';
export { ModChannel, MOD_FRAME_MAX_BYTES } from './channel.js';
