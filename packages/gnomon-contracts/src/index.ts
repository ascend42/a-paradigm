/**
 * @a-company/gnomon-contracts — the Gnomon kernel's versioned hard contracts
 * (spec §4, §18). Zero runtime dependencies. JSON Schemas live in ../schemas/.
 *
 * PR-0 ships only probeResult:v1; event:v1, ref:v1, refusal:v1 and the
 * gnomon-rpc:v1 `hello` shape land in PR-3 (research 29 §4).
 */

export const CONTRACTS_PACKAGE = '@a-company/gnomon-contracts' as const;

export * from './probe-result.js';
