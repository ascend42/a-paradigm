/**
 * @symbol #manifest-loader
 *
 * S0b (mod ids): who owns a `modns.*` event kind. Dependency-free on purpose (the log's redaction, the socket's
 * log.append gate and the mod host all import it; none may pull the grant reader in).
 */

/**
 * The FROZEN format-1 alias table (S0b §4): the bare names of the bundled first-party mods before S0b. A test fails if
 * format-1 support is removed while this table remains (the two expire together).
 */
export const LEGACY_ALIASES: readonly string[] = Object.freeze(['workshop', 'ledger', 'paradigm-context']);

/**
 * Does a mod own an event kind (S0b §2)? Its own `modns.<publisher>.<name>.` by WHOLE segments (the trailing dot), or,
 * for an alias-table entry gnomon.<N> only, its legacy `modns.<N>.` (publisher N is reserved, so nobody else can own it).
 */
export function ownsModKind(id: string, kind: string): boolean {
  const own = `modns.${id}.`;
  if (kind.startsWith(own) && kind.length > own.length) return true;
  const n = id.startsWith('gnomon.') ? id.slice(7) : null;
  const legacy = n !== null ? `modns.${n}.` : '';
  return n !== null && LEGACY_ALIASES.includes(n) && kind.startsWith(legacy) && kind.length > legacy.length;
}
