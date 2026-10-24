/**
 * @symbol #manifest-loader
 *
 * #manifest-loader egress policy (spec §3.6, §4.3, §15.4; G-MAN-01). Anthropic
 * API hosts are refused in a manifest's `requires.egress` and in every
 * `grant.egress` row: a mod never talks to Anthropic directly (law 7 — the
 * subscription path is the kernel's, never a mod's).
 *
 * Matching is fail-closed: the host is lower-cased, a trailing dot and a
 * `:port` are stripped, and a WILDCARD that could match an Anthropic host
 * (`*`, `*.com`, `*.anthropic.com`) is refused as well. Malformed hosts
 * (empty, whitespace, a scheme, a path, `@`) are refused as not-a-host.
 *
 * Also refused (Aegis F8): any port (`host:443` — the egress proxy decides
 * ports, a grant names hosts only); numeric hosts in any form (an all-numeric
 * last label covers dotted-quad and decimal, a `0x…`/octal label the hex and
 * octal forms); single-label names; and local/private names (`localhost`,
 * `*.localhost`, `.local`, `.internal`, `.lan`, `.home.arpa`, `.localdomain`).
 * The resolved-IP check against Anthropic and private ranges is the egress
 * proxy's (M1.7); this is the name-level gate.
 */

/** Registrable domains whose hosts are Anthropic API / product endpoints. */
export const ANTHROPIC_DOMAINS = Object.freeze(['anthropic.com', 'claude.ai', 'claude.com']);

const HOST_LABEL = /^(\*|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;

/** Normalise a host for comparison, or null when it is not a plain host[:port]. */
export function normalizeHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let h = raw.trim().toLowerCase();
  if (h === '' || /[\s/@?#\\]/.test(h) || h.includes('://')) return null;
  if (h.startsWith('[')) return null; // IPv6 literals are not accepted in egress lists
  const colon = h.lastIndexOf(':');
  if (colon >= 0) {
    if (!/^\d{1,5}$/.test(h.slice(colon + 1))) return null;
    h = h.slice(0, colon);
  }
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (h === '') return null;
  const labels = h.split('.');
  if (!labels.every((l) => HOST_LABEL.test(l))) return null;
  // a wildcard is only legal as the whole leftmost label
  if (labels.slice(1).includes('*')) return null;
  return h;
}

/** Does `pattern` (an exact host or `*.<suffix>` / `*`) match `host`? */
function patternMatches(pattern: string, host: string): boolean {
  if (pattern === '*') return true;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return pattern === host;
}

/** True when the (possibly wildcard) host could reach an Anthropic domain. */
export function isAnthropicHost(raw: unknown): boolean {
  const h = normalizeHost(raw);
  if (h === null) return false;
  for (const d of ANTHROPIC_DOMAINS) {
    if (h === d || h.endsWith(`.${d}`)) return true; // exact host or a subdomain
    // a wildcard whose suffix covers the domain (`*`, `*.com`, `*.claude.ai`)
    if (patternMatches(h, d) || patternMatches(h, `x.${d}`)) return true;
  }
  return false;
}

export type EgressRefusalWhy = 'anthropic' | 'not-a-host' | 'port' | 'numeric' | 'single-label' | 'private-name';
export type EgressVerdict = { ok: true; host: string } | { ok: false; host: string; why: EgressRefusalWhy };

export const PRIVATE_NAME_SUFFIXES = Object.freeze(['localhost', 'local', 'internal', 'lan', 'home.arpa', 'localdomain', 'intranet', 'corp']);

/** Check one egress host. */
export function checkEgressHost(raw: unknown): EgressVerdict {
  const h = normalizeHost(raw);
  if (h === null) return { ok: false, host: String(raw), why: 'not-a-host' };
  if (isAnthropicHost(h)) return { ok: false, host: h, why: 'anthropic' };
  if (/:\d+$/.test(String(raw).trim())) return { ok: false, host: h, why: 'port' };
  const labels = h.split('.');
  if (/^(0x[0-9a-f]+|\d+)$/.test(labels[labels.length - 1]!)) return { ok: false, host: h, why: 'numeric' };
  if (labels.length < 2 || (labels.length === 2 && labels[0] === '*')) return { ok: false, host: h, why: labels[labels.length - 1] === 'localhost' ? 'private-name' : 'single-label' };
  if (PRIVATE_NAME_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`))) return { ok: false, host: h, why: 'private-name' };
  return { ok: true, host: h };
}
