/**
 * @symbol #kernel-log
 *
 * #kernel-log (spec §3.2; research 33 S33-05..S33-07, S33-10; P8-D82, P8-D83) — the head-anchor
 * WRITE POLICY: when the file anchor and the keystore anchor are written, which
 * kinds force both anchors before `append` resolves, and the lag bounds that
 * open() enforces. Pure constants and predicates; kernel-log.ts applies them.
 *
 * Measured basis (probes/p-log-fsync, research 33 table): a tmp+rename after
 * every commit (arm B) leaves dirty APFS metadata that the next WAL fsync must
 * flush — 0.94 % of appends over 5 ms. Coalescing to 1 rename per 64 rows
 * (arm D) or per 50 ms (arm E) is indistinguishable from raw SQLite (arm A).
 *
 * Off-by-one, stated: the commit and the anchor write are not atomic, so a
 * crash right after the commit that triggers an anchor leaves lag = trigger.
 * The spec's open bound is "lag > 63 ⇒ INTEGRITY_BROKEN", so the in-path
 * trigger fires when the un-anchored row count REACHES 63 (rename rate 1/63,
 * ≈ arm D's 1/64). Same for the keystore: trigger at 1023, bound 1023.
 */

/** S33-07: open refuses INTEGRITY_BROKEN{anchor-lag} when the file anchor lags by more than this. */
export const FILE_ANCHOR_MAX_LAG = 63;
/** S33-05: file anchor written within this many ms of the first un-anchored row (unref'd timer). */
export const FILE_ANCHOR_MAX_MS = 50;
/** S33-07: keystore lag above this on open ⇒ a kernel-signed `daemon.anchor.lag{rows, which}`. */
export const KEYSTORE_ANCHOR_MAX_LAG = 1023;
/** S33-05: keystore anchor written (async, off the append path) within this many ms. Provisional until P04. */
export const KEYSTORE_ANCHOR_MAX_MS = 1000;
/** S33-06 telemetry: forcedAnchorRate is computed over this many most recent rows. */
export const FORCED_ANCHOR_WINDOW = 10_000;
/** S33-06: above this forced-anchor rate the bulk p99 is outside the measured envelope (arm D). */
export const FORCED_ANCHOR_ENVELOPE = 1 / 64;

/**
 * S33-06 — the CRITICAL kinds (research 33, "The list"). A critical append
 * commits (bulk durability — no F_FULLFSYNC since S33-10 / P8-D83), renames
 * the file anchor in and awaits the keystore anchor, in that order, and only
 * then resolves; no effect of the event may be released before the promise
 * resolves. That is an ordering guarantee against a same-user process, not a
 * power-loss guarantee (an anchor ahead of the db after a power loss is
 * classified on open, kernel-log.ts).
 *
 * Deviations from the spec list, stated:
 *   - `manifest.*` "(decisions)": the whole manifest namespace is treated as
 *     critical (conservative; every manifest kind is a human-speed event).
 *   - `grant.*`: no `grant` namespace is registered in contracts yet
 *     (permit.grant / request.grant are other namespaces); the prefix is kept
 *     so a future `grant.*` kind is critical on registration.
 *   - `link.*` (pair/renew/revoke) maps to the registered kinds
 *     link.pair.offered, link.paired, link.renewed, link.revoked.
 *   - `approval.rule.revoked` (P8-D98, Aegis M1) is added beside
 *     `approval.rule.learned`: a lost revoke silently widens permission
 *     (the rule comes back), so it is anchored like the learn it undoes.
 *   - `approval.rule.disabled` (8.0:rules-view) likewise: a lost "off" silently
 *     turns the rule back on. (`approval.rule.enabled` is not critical: a lost
 *     one leaves the rule off, the narrow side.)
 */
export const CRITICAL_ANCHOR_KINDS = Object.freeze({
  ref: 'research 33 S33-06 (P8-D82)',
  kinds: Object.freeze([
    'approval.decide',
    'approval.suspect',
    'approval.presence.denied',
    'approval.rule.learned',
    'approval.rule.revoked',
    'approval.rule.disabled',
    'approval.voice.arm',
    'approval.voice.disarm',
    'link.pair.offered',
    'link.paired',
    'link.renewed',
    'link.revoked',
    'socket.auth.theft',
  ] as const),
  namespaces: Object.freeze(['key', 'grant', 'config', 'manifest', 'billing', 'verdict'] as const),
  /** Kinds critical only for some payloads: session.inject{origin:'peer'} (L2 for peer bytes). */
  byPayload: Object.freeze({ 'session.inject': Object.freeze({ field: 'origin', equals: 'peer' }) }),
});

/** Is this (kind, payload) a S33-06 critical append? */
export function isCriticalKind(kind: string, payload?: unknown): boolean {
  if ((CRITICAL_ANCHOR_KINDS.kinds as readonly string[]).includes(kind)) return true;
  const dot = kind.indexOf('.');
  if (dot > 0 && (CRITICAL_ANCHOR_KINDS.namespaces as readonly string[]).includes(kind.slice(0, dot))) return true;
  const rule = (CRITICAL_ANCHOR_KINDS.byPayload as Readonly<Record<string, { field: string; equals: string }>>)[kind];
  if (rule && payload && typeof payload === 'object') return (payload as Record<string, unknown>)[rule.field] === rule.equals;
  return false;
}
