/**
 * @symbol #gnomon-mod-sdk
 *
 * @a-company/gnomon-mod-sdk (spec §18): the mod-abi:v1 types (re-exported from
 * @a-company/gnomon-contracts), the mod runtime `serveMod` (runtime.ts, also
 * built as the single vendorable file dist/runtime.js) and the example mod
 * (example/hello). M1.11 slice 1. Slice 2: the fixture/golden test harness,
 * `gnomon mod new|types|test` scaffolding and link/dev tooling. The per-session
 * `gnomon-mods` bridge is NOT here: the kernel answers it (#mod-tool-bridge,
 * packages/gnomon/src/kernel/modhost/mcp-bridge.ts, Dimensions S1.4).
 */
export { MOD_ABI_V1, MOD_ABI_ID, MOD_ABI_RPCS, MOD_ABI_LIFECYCLE, MOD_ABI_DESCRIPTOR, MOD_EFFECTS, MOD_BLOCK_LIMITS, KIT_V1_BLOCKS } from '@a-company/gnomon-contracts';
export type { ModEffect, RelayedFor, ToolRelayedFor, ModRpcDescriptor } from '@a-company/gnomon-contracts';
export { serveMod, egressConnect, ModCallError } from './runtime.js';
export type { ModDefinition, ModApi, CallContext, ViewContext, Block } from './runtime.js';

/** Where the example mod lives in this package (relative to the package root). */
export const EXAMPLE_MOD_DIR = 'example/hello' as const;
/** The file name a mod vendors the runtime under (the example imports it). */
export const VENDORED_RUNTIME = 'gnomon-mod-sdk.mjs' as const;
