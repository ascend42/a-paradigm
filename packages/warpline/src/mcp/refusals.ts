/**
 * #warpline-mcp — the TWO skin-built refusals (mcp-skin-spec D3), and the only
 * `refuse()` call sites permitted in `src/mcp/`: they exist because no daemon
 * is present to build them. Every other refusal arrives from the wire VERBATIM
 * (error frames and result.refusal) — the skin never re-derives a vocabulary.
 */

import { refuse, type Refusal } from '../fabric/refusal.js';

/**
 * The daemon cannot be reached (and auto-start, if permitted, did not help).
 * The structured replacement for the prose at client.ts connect: starting the
 * daemon is the human's act, so the ladder escalates. retry-identical: once
 * the daemon is up, the very same call succeeds.
 */
export function daemonDownRefusal(): Refusal {
  return refuse({
    code: 'UNSUPPORTED',
    gate: 'transport',
    retriable: 'retry-identical',
    next: [{ verb: 'daemon.start', params: {}, requires: [], principal: 'human' }],
  });
}

/**
 * No token discoverable (env or mcp.token file). Minting is deliberately
 * human-gated CLI-only (anti-sockpuppet) — the ladder names the exact mint
 * call; params are ALREADY DETERMINED (copy verbatim).
 */
export function tokenMissingRefusal(): Refusal {
  return refuse({
    code: 'AUTH',
    next: [
      { verb: 'daemon.token.mint', params: { name: 'mcp', kind: 'agent', mcp: 'true' }, requires: [], principal: 'human' },
    ],
  });
}
