/**
 * anchor-path — back-compat shim.
 *
 * The implementation moved to `@a-company/premise-core` (src/anchor-path.ts)
 * when the triplicated aspect-anchor check was consolidated. This module is
 * retained so existing imports (`tags.ts`, `aspect-graph.ts`, …) keep working.
 * Prefer importing from `@a-company/premise-core` directly in new code.
 */
export { resolveAnchorPath, detectAnchorBaseMismatch } from '@a-company/premise-core';
export type { AnchorBase, ResolveAnchorPathResult, AnchorBaseMismatch } from '@a-company/premise-core';
