/**
 * @symbol #kernel-custody
 *
 * Aegis S2 H-3 (TD-2026-10-29-746, option b): a row that only NARROWS is honoured from any key in the verified,
 * anchored hash chain, not only from a kernel key. After the seal, a certless start (a checkout, an npm run) signs
 * with a key the next start does not trust; without this, a revocation it wrote would silently come back at the next
 * certified start. A row that grants or loosens still requires a kernel key (isKernelKey), so a forged row can only
 * take something away, never add it. The daemon never refuses to start over custody (founder: no stoppages).
 */

/** Kinds that only narrow, whatever their payload. */
const ALWAYS_NARROWING = new Set([
  'approval.rule.revoked', // an Always rule revoked
  'approval.rule.disabled', // an Always rule turned off
  'grant.standing.revoked', // the daily standing grant ended
  'approval.strictness.raised', // a stricter level
  'budget.ladder', // a fuse rung announced (a trip warning only narrows)
]);

/** Does this row only take something away (revocation, denial, fuse trip, strictness raise, trust cleared)? */
export function isNarrowingRow(kind: string, payload: unknown): boolean {
  if (ALWAYS_NARROWING.has(kind)) return true;
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  if (kind === 'tool.trust') return p.op === 'cleared' || p.op === 'dropped'; // an MCP/tool trust revocation
  return false;
}
