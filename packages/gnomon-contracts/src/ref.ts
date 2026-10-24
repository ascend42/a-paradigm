/**
 * ref:v1 (spec §4.4, §3.7, §3.9).
 *
 *   ref = scheme ":" id ["@" rev]
 *
 * Kernel built-ins (§3.7): ev hsid cc gkey dev permit card contract node pev peer.
 * Package-registered (§3.7/§4.4): spec sym wl n s td l t knot doodle.
 * `peer:<logId>/<ref>` names an object on a paired kernel (reserved in M1.1 for
 * P8-R9) and never dereferences a local object. The `voice` scheme is dropped
 * (A23-2). Aliases: `# $ ^ ! ~` → sym:, `TD-` → td:, `L-` → l:, `T-` → t:.
 *
 * Spec gap resolved here: §3.9 rewrites `turn:` refs at receipt
 * (`peer:<logId>/turn:…`) and §4.2 defines `turn:<hsid>/<n>`, but neither
 * scheme list names `turn`. It is registered as a kernel built-in so turn ids
 * parse as refs; flagged for the spec owner.
 */

import { ID_PATTERNS } from './ids.js';

export const REF_V1 = 'ref:v1' as const;

export const KERNEL_REF_SCHEMES = [
  'ev',
  'hsid',
  'cc',
  'gkey',
  'dev',
  'permit',
  'card',
  'contract',
  'node',
  'pev',
  'peer',
  'turn',
] as const;
export const PACKAGE_REF_SCHEMES = ['spec', 'sym', 'wl', 'n', 's', 'td', 'l', 't', 'knot', 'doodle'] as const;
export const REF_SCHEMES = [...KERNEL_REF_SCHEMES, ...PACKAGE_REF_SCHEMES] as const;
export type RefScheme = (typeof REF_SCHEMES)[number];

/** Schemes reserved one release ahead (§4.9 / A26-11): `peer` (P8-R9, M1.1). */
export const RESERVED_REF_SCHEMES: readonly RefScheme[] = ['peer'];
/** Dropped schemes: a ref using one is refused even in tolerant mode. */
export const DROPPED_REF_SCHEMES = ['voice'] as const;

export const REF_ALIASES: ReadonlyArray<{ prefix: string; scheme: RefScheme; keepPrefix: boolean }> = [
  { prefix: '#', scheme: 'sym', keepPrefix: true },
  { prefix: '$', scheme: 'sym', keepPrefix: true },
  { prefix: '^', scheme: 'sym', keepPrefix: true },
  { prefix: '!', scheme: 'sym', keepPrefix: true },
  { prefix: '~', scheme: 'sym', keepPrefix: true },
  { prefix: 'TD-', scheme: 'td', keepPrefix: true },
  { prefix: 'L-', scheme: 'l', keepPrefix: true },
  { prefix: 'T-', scheme: 't', keepPrefix: true },
];

export const REF_SCHEME_PATTERN = /^[a-z][a-z0-9-]*$/;

export interface ParsedRef {
  scheme: string;
  id: string;
  rev?: string;
  /** scheme is in REF_SCHEMES. */
  registered: boolean;
  /** for `peer:` refs: the paired kernel's log id and the inner ref. */
  peer?: { logId: string; inner: ParsedRef };
}

/** Expand an alias (`#foo` → `sym:#foo`); other input is returned unchanged. */
export function expandRefAlias(input: string): string {
  for (const a of REF_ALIASES) {
    if (input.startsWith(a.prefix) && input.length > a.prefix.length) {
      return `${a.scheme}:${a.keepPrefix ? input : input.slice(a.prefix.length)}`;
    }
  }
  return input;
}

/**
 * Parse a ref (aliases expanded first). `rev` is after the LAST `@`. Returns
 * undefined on a syntax error, a dropped scheme, a malformed peer ref or a
 * nested peer ref. Unregistered schemes parse (`registered: false`) — the
 * strict validator refuses them, the tolerant one renders them opaquely.
 */
export function parseRef(input: string): ParsedRef | undefined {
  if (typeof input !== 'string' || input.length === 0 || /\s/.test(input)) return undefined;
  const s = expandRefAlias(input);
  const colon = s.indexOf(':');
  if (colon <= 0) return undefined;
  const scheme = s.slice(0, colon);
  if (!REF_SCHEME_PATTERN.test(scheme)) return undefined;
  if ((DROPPED_REF_SCHEMES as readonly string[]).includes(scheme)) return undefined;
  let rest = s.slice(colon + 1);
  let rev: string | undefined;
  const at = rest.lastIndexOf('@');
  if (at >= 0 && scheme !== 'peer') {
    rev = rest.slice(at + 1);
    rest = rest.slice(0, at);
    if (rev.length === 0) return undefined;
  }
  if (rest.length === 0) return undefined;
  const registered = (REF_SCHEMES as readonly string[]).includes(scheme);
  const out: ParsedRef = { scheme, id: rest, registered, ...(rev !== undefined ? { rev } : {}) };
  if (scheme === 'peer') {
    const slash = rest.indexOf('/');
    if (slash <= 0) return undefined;
    const logId = rest.slice(0, slash);
    if (!ID_PATTERNS.log.test(logId)) return undefined;
    const inner = parseRef(rest.slice(slash + 1));
    if (!inner || inner.scheme === 'peer') return undefined;
    out.peer = { logId, inner };
  }
  return out;
}

export function formatRef(r: { scheme: string; id: string; rev?: string }): string {
  return `${r.scheme}:${r.id}${r.rev !== undefined ? `@${r.rev}` : ''}`;
}

/** `peer:<logId>/<ref>` — the receipt-time rewrite of a source kernel's ref (§3.9). */
export function peerRef(sourceLogId: string, ref: string): string {
  if (!ID_PATTERNS.log.test(sourceLogId)) throw new TypeError(`not a log id: ${sourceLogId}`);
  const inner = parseRef(ref);
  if (!inner || inner.scheme === 'peer') throw new TypeError(`not a rewritable ref: ${ref}`);
  return `peer:${sourceLogId}/${formatRef(inner)}`;
}

/** Validate a ref string. Strict: registered scheme required. */
export function validateRefV1(value: unknown, opts: { mode?: 'strict' | 'tolerant' } = {}): string[] {
  if (typeof value !== 'string') return ['ref must be a string'];
  const p = parseRef(value);
  if (!p) return [`malformed ref: ${value}`];
  if ((opts.mode ?? 'strict') === 'strict') {
    if (!p.registered) return [`unregistered ref scheme: ${p.scheme}`];
    if (p.peer && !p.peer.inner.registered) return [`unregistered ref scheme: ${p.peer.inner.scheme}`];
  }
  return [];
}

export function isRefV1(value: unknown): value is string {
  return validateRefV1(value).length === 0;
}

/** JSON Schema pattern for a canonical (alias-expanded) registered ref. */
export const REF_V1_JSON_PATTERN = `^(${REF_SCHEMES.join('|')}):[^\\s]+$`;
