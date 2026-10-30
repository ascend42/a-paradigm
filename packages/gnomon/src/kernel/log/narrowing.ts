/**
 * @symbol #kernel-custody
 *
 * Aegis S2 H-3 (TD-2026-10-29-746, option b): a row that only NARROWS is honoured from any key in the verified,
 * anchored hash chain, not only from a kernel key. After the seal, a certless start (a checkout, an npm run) signs
 * with a key the next start does not trust; without this, a revocation it wrote would silently come back at the next
 * certified start. A row that grants or loosens still requires a kernel key (isKernelKey), so a forged row can only
 * take something away, never add it. The daemon never refuses to start over custody (founder: no stoppages).
 */

/**
 * Kinds that only narrow, whatever their payload (pure revocations). Rows that narrow only against the CURRENT state
 * (a strictness raise, a rule's off period, a loop pause or tightening) are decided per row inside their book
 * (Aegis S2 re-check H-1): StrictnessBook, RuleBook, the loop ledger. budget.ladder is not here: a rung can loosen.
 */
const ALWAYS_NARROWING = new Set([
  'approval.rule.revoked', // an Always rule revoked
  'grant.standing.revoked', // the daily standing grant ended
]);

/** Does this row only take something away whatever the current state (a pure revocation, a trust cleared)? */
export function isNarrowingRow(kind: string, payload: unknown): boolean {
  if (ALWAYS_NARROWING.has(kind)) return true;
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  if (kind === 'tool.trust') return p.op === 'cleared' || p.op === 'dropped'; // an MCP/tool trust revocation
  return false;
}

/**
 * Aegis S2 sign-off N-1 (M-7): the kernel's OWN appends that are anchored at once (the append awaits the helper
 * anchor). Kind alone decides here: these rows are written by this kernel, so no per-row trust question arises.
 */
const ANCHOR_NOW = new Set([
  'approval.rule.revoked',
  'approval.rule.disabled',
  'grant.standing.revoked',
  'approval.strictness.raised',
  'loop.paused',
  'loop.budget.tightened',
  // fuse trips
  'budget.pause',
  'budget.breaker.open',
  'budget.ladder',
  'permit.deny',
]);

export function anchorNow(kind: string, payload?: unknown): boolean {
  if (ANCHOR_NOW.has(kind)) return true;
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return kind === 'tool.trust' && (p.op === 'cleared' || p.op === 'dropped');
}
