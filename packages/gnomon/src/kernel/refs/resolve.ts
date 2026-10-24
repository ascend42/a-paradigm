/**
 * @symbol #ref-resolver
 *
 * #ref-resolver (spec §3.7, §4.4, §5 verb 12 `ref.resolve`; M1.4 slice 2) —
 * the kernel's resolver for its BUILT-IN ref schemes, read-only.
 *
 * Served now: `ev:<ULID>` — the event row with that id, re-hashed (a row that
 * fails its hash is withheld, ENGINE{row-integrity}) and projected through
 * the caller's §9.3 reader class (redaction.ts). A missing row and a row the
 * reader may not see are the SAME answer, NOT_FOUND — `ref.resolve` is never
 * an existence oracle; visibility is decided before the hash check, so
 * row-integrity is only reported for a row the reader could see. Limited
 * readers get no `hash` (round 2: no confirmation oracle). A reader class with no projection yet (agent: Move 2,
 * voice: Move 4, session: M1.7) refuses before any lookup.
 *
 * Validated, then refused ENGINE{not-implemented, milestone}: `turn:<hsid>/<n>`
 * and `hsid:` (no session rows exist before M1.7), and the other kernel
 * built-ins (cc, gkey, dev, permit, card, contract, node, pev) at their
 * milestones. Refused UNSUPPORTED: `peer:` (resolved only to a copy a brief
 * carried, §3.9 — no link exists), package schemes (sym wl n s td l t spec
 * knot doodle: their resolvers are userland, registered by their packages)
 * and unknown schemes. Malformed refs, dropped schemes (`voice`) and an `@rev`
 * on an immutable event are BAD_REQUEST.
 */
import { isHsid, isId, KERNEL_REF_SCHEMES, parseRef, formatRef, type ParsedRef, type RefusalCode, type RefusalData } from '@a-company/gnomon-contracts';
import type { LogView, ReaderClass } from '../log/redaction.js';

/** Longest ref string accepted (a ref is an id, not a payload). */
export const MAX_REF_CHARS = 512;

/** Kernel built-in schemes not resolvable yet, and where they land (spec §19). */
export const BUILTIN_REF_MILESTONES: Readonly<Record<string, string>> = Object.freeze({
  hsid: 'M1.7',
  turn: 'M1.7',
  cc: 'M1.7',
  gkey: 'M1.3',
  dev: 'M1.3',
  permit: 'M1.6',
  card: 'M1.6',
  contract: 'M2.1',
  node: 'M2.1',
  pev: 'Move 2', // the spec names no milestone for pev (flagged)
});

export const SERVED_REF_SCHEMES: readonly string[] = Object.freeze(['ev']);

export interface RefLookup {
  getById(id: string, reader: ReaderClass): LogView | 'withheld' | undefined;
}

export type RefResolution =
  | { ok: true; result: { ref: string; target: LogView; hash?: string } }
  | { ok: false; code: RefusalCode; reason: string; message: string; data?: RefusalData };

const fail = (code: RefusalCode, reason: string, message: string, data?: RefusalData): RefResolution => ({ ok: false, code, reason, message, ...(data ? { data } : {}) });

const TURN_ID = /^(hsid:[^/]+)\/([1-9][0-9]{0,15})$/;

/**
 * Resolve `params.ref` for a reader. `reader` is called only when a lookup
 * needs a projection (it may throw the caller's class refusal).
 */
export function resolveRef(params: unknown, log: RefLookup, reader: () => ReaderClass): RefResolution {
  const raw = params !== null && typeof params === 'object' ? (params as { ref?: unknown }).ref : undefined;
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_REF_CHARS) {
    return fail('BAD_REQUEST', 'bad-ref', `ref must be a non-empty string of at most ${MAX_REF_CHARS} characters`);
  }
  const p: ParsedRef | undefined = parseRef(raw);
  if (!p) return fail('BAD_REQUEST', 'bad-ref', 'not a ref:v1 (scheme ":" id ["@" rev]); dropped schemes are refused');
  if (!p.registered) return fail('UNSUPPORTED', 'unknown-scheme', `no scheme ${JSON.stringify(p.scheme.slice(0, 32))} is registered`, { scheme: p.scheme.slice(0, 32) });
  if (p.scheme === 'peer') return fail('UNSUPPORTED', 'peer-ref', 'peer refs resolve only to a copy a handoff brief carried (§3.9); no link exists', { scheme: 'peer' });
  if (!(KERNEL_REF_SCHEMES as readonly string[]).includes(p.scheme)) {
    return fail('UNSUPPORTED', 'no-resolver', `${p.scheme}: refs are resolved by the package that registers the scheme (userland), not the kernel`, { scheme: p.scheme, registeredBy: 'package' });
  }
  if (p.scheme === 'ev') {
    const id = `ev:${p.id}`;
    if (p.rev !== undefined) return fail('BAD_REQUEST', 'rev-not-applicable', 'events are immutable: an ev ref takes no @rev');
    if (!isId('ev', id)) return fail('BAD_REQUEST', 'bad-ref', 'ev refs are ev:<ULID>');
    const r = reader();
    const v = log.getById(id, r);
    if (v === 'withheld') return fail('ENGINE', 'row-integrity', 'the row failed its hash check and is withheld from every reader', { ref: id });
    if (!v) return fail('NOT_FOUND', 'not-found', 'no such event for this reader', { ref: id });
    // hash only when the view itself carries it (full-class readers); limited views get none (no confirmation oracle)
    const hash = v.view === 'stub' ? v.stub.hash : v.event.hash;
    return { ok: true, result: { ref: formatRef(p), target: v, ...(hash !== undefined ? { hash } : {}) } };
  }
  if (p.scheme === 'turn') {
    const m = TURN_ID.exec(p.id);
    if (!m || !isHsid(m[1])) return fail('BAD_REQUEST', 'bad-ref', 'turn refs are turn:<hsid>/<n> with n >= 1 (§4.2)');
  }
  if (p.scheme === 'hsid' && !isHsid(`hsid:${p.id}`)) return fail('BAD_REQUEST', 'bad-ref', 'hsid refs are hsid:v1:<ULID> or hsid:v1d:<base32>');
  const milestone = BUILTIN_REF_MILESTONES[p.scheme] ?? 'unassigned';
  return fail('ENGINE', 'not-implemented', `${p.scheme}: refs resolve from ${milestone}`, { scheme: p.scheme, milestone });
}
