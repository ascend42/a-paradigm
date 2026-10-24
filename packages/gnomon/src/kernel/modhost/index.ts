/**
 * @symbol #mod-host
 *
 * #mod-host public surface (spec §3.8, §12; M1.11 slices 1–2). The unsandboxed
 * launcher and the egress dialer are NOT here: they are test seams only
 * (kernel/testing.ts createModHostForTest).
 */
export { ModHost, HOST_INPUT_KEYS, MOD_ENTRIES, DEFAULT_CALL_TIMEOUT_MS, DEFAULT_CANCEL_GRACE_MS, RESTART_CAP, FOLDER_DEBOUNCE_MS, MAX_MOD_HOST_INFLIGHT, RELAY_MISS_ROWS_PER_WINDOW, RELAY_MISS_WINDOW_MS, EFFECT_REFUSED_ROWS_PER_WINDOW, EFFECT_REFUSED_WINDOW_MS } from './host.js';
export { createModKernelCall, createModRelayPort, clampModAppend, MOD_APPEND_MAX_BYTES, MOD_APPEND_FIELDS, MOD_APPEND_ROWS_PER_SEC, MOD_APPEND_BYTES_PER_CALL } from './bridge.js';
export type { ModKernelPorts, ModRelays, ModAppendRow, ModKernelCall } from './bridge.js';
export { RowFold, FOLD_MAX_KEYS, FOLD_DISTINCT_CAP, FOLD_KEY_MAX } from './fold.js';
export type { ModHostOptions, ModChildrenPort, KernelCallRequest, ModStartResult, RenderResult, CallOptions } from './host.js';
export { ModRefusal, isModRefusal, MOD_REFUSAL_CODES } from './refusal.js';
export type { ModRefusalCode } from './refusal.js';
export { declaredEffects, effectsFor, verbEffect, methodEffect } from './effects.js';
export type { CallContext } from './effects.js';
export { sanitizeModBlock } from './block.js';
export { EgressProxy, EGRESS_PORTS, isNonPublicAddress } from './egress-proxy.js';
export { ModState, STATE_LIMITS, stateDir, blobsDir } from './state.js';
export { ModChannel, MOD_FRAME_MAX_BYTES } from './channel.js';
export { StagedCardPickup, pendingStaged, listStaged, readStagedEntry, claimLine, MAX_PICKUP_READS, MAX_STAGED_BYTES, MAX_LISTED, isUserPaused, writePause, requestStart, takeStartRequest, requestUninstall, uninstallRequested, UNINSTALL_REQUEST, modNames, modsRoot, PAUSE_MARKER, START_REQUEST, MAX_PICKUP_CARDS, MAX_PICKUP_REFUSED, PICKUP_SCAN_MS } from './control.js';
export type { PendingStaged, StagedEntry, PickupHost, PickupOptions } from './control.js';
export { projectFeedEvent, feedBacklog, FeedBacklog, FEED_KINDS, FEED_BACKLOG_KINDS, FEED_BACKLOG_LIMITS, FEED_CAPABILITY, FEED_USAGE_CAPABILITY, FEED_USAGE_KINDS, FEED_HUES } from './feed.js';
export type { FeedSourceRow } from './feed.js';
export type { FeedEvent } from './feed.js';
export { paradigmSlice, paradigmRootOf, readYamlSubset, displayTitle, redactPaths, ParadigmSliceCache, unfocusedSlice, PARADIGM_SLICE_V1, PARADIGM_SUMMARY_CAPABILITY, SLICE_TOP, TITLE_MAX } from './paradigm-slice.js';
export type { ParadigmSlice, SliceItem } from './paradigm-slice.js';
