/**
 * @symbol #kernel-log
 *
 * #kernel-log (spec §3.2 data model, "Signatures and anchors", L1/L6/L7) — the
 * pure chain rules: hashing, genesis, the signature policy, label rules and
 * the log's refusal error. No I/O here.
 *
 *   hash      = sha256(canonical(envelope minus hash, sig))   (tagged `sha256:<hex>`)
 *   prev(1)   = sha256("gnomon-log-genesis:" + logId)
 *   canonical = Warpline's serializer (contracts `canonicalJson`)
 */
import { createHash } from 'node:crypto';
import {
  canonicalJson,
  defaultLabelsFor,
  kindOwner,
  refuse,
  RefusedError,
  SENSITIVITIES,
  type Audience,
  type EventLabels,
  type KindOwner,
  type RefusalCode,
  type Sensitivity,
} from '@a-company/gnomon-contracts';

export const GENESIS_PREFIX = 'gnomon-log-genesis:' as const;

/** `sha256:<hex>` of a UTF-8 string (node:crypto; same digest as contracts' sha256Tagged). */
export function sha256TaggedFast(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/** prev of seq 1. `logId` is the full `log:<ULID>` id, as in `envelope.log`. */
export function genesisPrev(logId: string): string {
  return sha256TaggedFast(GENESIS_PREFIX + logId);
}

/** The text that is hashed (and stored in `chain.envelope`): canonical(envelope minus hash, sig). */
export function hashPreimage(envelope: Record<string, unknown>): string {
  const { hash: _h, sig: _s, ...rest } = envelope;
  return canonicalJson(rest);
}

/* ── signature policy (§3.2) ──────────────────────────────────────────────── */

/** Namespaces whose events MUST carry a signature (§3.2, verbatim list). */
export const SIG_MANDATORY_NAMESPACES = [
  'approval',
  'budget',
  'permit',
  'key',
  'manifest',
  'config',
  'billing',
  'verdict',
] as const;
/**
 * Single kinds whose events MUST carry a signature (§3.2), plus the
 * integrity rows of the log itself (research 33 S34-06, P8-D83): a stripped
 * signature on a gap / segment / lag / anchor-failure / socket-theft row would
 * otherwise pass verify as a "diagnostic".
 */
export const SIG_MANDATORY_KINDS = ['oracle.result', 'daemon.log.gap', 'daemon.log.quarantined', 'daemon.segment', 'daemon.anchor.lag', 'daemon.anchor.failed', 'socket.auth.theft'] as const;
/** Diagnostics that MAY be unsigned (§3.2): the ONLY unsigned rows the log accepts. */
export const DIAGNOSTIC_NAMESPACES = ['daemon', 'socket', 'schedule'] as const;

const ns = (kind: string): string => kind.slice(0, kind.indexOf('.'));

export function isSigMandatory(kind: string): boolean {
  return (
    (SIG_MANDATORY_NAMESPACES as readonly string[]).includes(ns(kind)) ||
    (SIG_MANDATORY_KINDS as readonly string[]).includes(kind)
  );
}

export function isDiagnostic(kind: string): boolean {
  return (DIAGNOSTIC_NAMESPACES as readonly string[]).includes(ns(kind));
}

/**
 * May this kind be appended unsigned? Only diagnostics. §3.2 also says
 * "kernel-appended events are signed by the kernel key" and "every event
 * appended by a keyed principal" is signed, so outside the three diagnostic
 * namespaces an unsigned row is refused at append and fails verify — a
 * superset of the mandatory list (G-LOG-08 tests the mandatory list). The
 * sig-mandatory diagnostic kinds (daemon.log.gap etc., S34-06) are excluded.
 */
export function mayBeUnsigned(kind: string): boolean {
  return isDiagnostic(kind) && !isSigMandatory(kind);
}

/* ── labels (L6, S32 §6, G-LOG-09) ────────────────────────────────────────── */

const SENS_ORDER = SENSITIVITIES as readonly Sensitivity[];
/** private is the narrowest audience; team/org are 8.1 projections (Q6). */
const AUD_ORDER: readonly Audience[] = ['private', 'team', 'org'];

/**
 * The labels an append gets: the kind's §9.1 default, optionally TIGHTENED by
 * the appending component. Relaxing (a lower sensitivity, a wider audience)
 * is refused; an unregistered kind is refused — never guessed (`G-LOG-09`).
 */
export function resolveLabels(
  kind: string,
  requested: { audience?: Audience; sensitivity?: Sensitivity } = {},
): EventLabels {
  const d = defaultLabelsFor(kind);
  if (!d) throw logRefusal('BAD_REQUEST', 'unregistered-kind', `kind ${kind} is not in the §9.1 registry`, { kind });
  const sensitivity = requested.sensitivity ?? d.sensitivity;
  if (SENS_ORDER.indexOf(sensitivity) < SENS_ORDER.indexOf(d.sensitivity)) {
    throw logRefusal('FORBIDDEN', 'label-relaxed', `sensitivity ${sensitivity} is looser than the ${kind} default ${d.sensitivity}`, { kind });
  }
  const audience = requested.audience ?? d.audience;
  if (AUD_ORDER.indexOf(audience) > AUD_ORDER.indexOf(d.audience)) {
    throw logRefusal('FORBIDDEN', 'label-relaxed', `audience ${audience} is wider than the ${kind} default ${d.audience}`, { kind });
  }
  return { audience, sensitivity };
}

/** L7: a kernel appender never writes a userland kind, and vice versa. */
export function assertOwner(kind: string, as: KindOwner): void {
  const owner = kindOwner(kind);
  if (owner !== undefined && owner !== as) {
    throw logRefusal('FORBIDDEN', 'kind-owner', `${kind} is ${owner}-owned; a ${as} appender may not write it (L7)`, { kind });
  }
}

/* ── refusal ──────────────────────────────────────────────────────────────── */

export type LogRefusalReason =
  | 'unregistered-kind'
  | 'label-relaxed'
  | 'kind-owner'
  | 'unsigned-mandatory'
  | 'unsigned-kind'
  | 'bad-envelope'
  | 'bad-payload'
  | 'missing-db'
  | 'anchor-missing'
  | 'anchor-mismatch'
  | 'anchor-lag'
  | 'anchor-failed'
  | 'truncated'
  | 'tip-moved'
  | 'segment-broken'
  | 'reader-unsupported'
  | 'reserved-kind'
  | 'closed'
  /* S33-10 acknowledgeGap refusals (P8-D83) */
  | 'no-gap'
  | 'presence-required'
  | 'tamper'
  | 'unauthenticated-lead'
  /* S34-02 anchor-fault state */
  | 'anchor-faulted'
  /* S34-22 keyless (non-rotating, diagnostic-only) logs */
  | 'kernel-key-required'
  /* T-2026-10-17-009(a) `gnomon log quarantine` (in-process / CLI only, never on the wire) */
  | 'not-genesis'
  | 'not-a-home'
  | 'nothing-to-quarantine'
  | 'daemon-running'
  | 'quarantine-pending'
  | 'home-busy'
  | 'install-busy'
  | 'no-space'
  | 'not-interactive'
  | 'not-confirmed';

/** A refusal:v1 thrown by the log; `reason` is also in `refusal.data.reason`. */
export class LogRefusal extends RefusedError {
  readonly reason: LogRefusalReason;
  constructor(code: RefusalCode, reason: LogRefusalReason, message: string, data: Record<string, unknown> = {}) {
    super(refuse({ code, data: { reason, ...data } }), `#kernel-log: ${message}`);
    this.name = 'LogRefusal';
    this.reason = reason;
  }
}

export function logRefusal(
  code: RefusalCode,
  reason: LogRefusalReason,
  message: string,
  data: Record<string, unknown> = {},
): LogRefusal {
  return new LogRefusal(code, reason, message, data);
}
