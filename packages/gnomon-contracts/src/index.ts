/**
 * @a-company/gnomon-contracts — the Gnomon kernel's versioned hard contracts
 * (spec §4, §18). Zero runtime dependencies, platform-neutral (no node:*).
 * JSON Schemas live in ../schemas/ and are generated from src/schemas.ts.
 *
 * PR-0: probeResult:v1. PR-3 (research 29 §4): event:v1 + kind registry,
 * ids (ULID, hsid, hsid-short, turn ids), principals, ref:v1, refusal:v1,
 * card:v1, gnomon-rpc:v1 hello + negotiation + the compatible-additive rule,
 * the frozen 12 verbs + 2 relays, kitId and clientApiId; the P8-D58 and P8-R9
 * values reserved for M1.1. M1.1 part 2 (spec v3.9, §4.11): the P8-D86–D88
 * values (strictness, run modes, review convergence, change notes) and the
 * review-finding:v1 / change-note:v1 schemas.
 */

export const CONTRACTS_PACKAGE = '@a-company/gnomon-contracts' as const;

export * from './probe-result.js';
export { isPlainObject, sha256, sha256Tagged, hex, crockford, canonicalJson, utf8 } from './internal.js';
export type { ValidationMode, ValidateOptions } from './internal.js';
export * from './ids.js';
export * from './principal.js';
export * from './ref.js';
export * from './event.js';
export * from './refusal.js';
export * from './change-note.js';
export * from './review-finding.js';
export * from './card.js';
export * from './rpc.js';
export * from './schemas.js';
export * from './client-api.js';
export * from './mod-abi.js';
export * from './display.js';
export * from './conformance.js';
export type * from './client-types.js';
