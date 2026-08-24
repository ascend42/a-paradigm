/**
 * #prose-envelope — the injection-safety envelope (P2.4 minimum slice,
 * docs/specs/warpline-forge.md §3d; T-2026-06-24-013).
 *
 * Agent-authored prose (intents, knot-resolution reasons, proposal rationales)
 * is UNTRUSTED INPUT to any reading agent and to any rendering surface: a
 * validly-signed, content-addressed strand can still carry a prompt-injection
 * payload aimed at the gatekeeper. Three layers, two of which live here:
 *
 *   1. TYPED ENVELOPE, born content-addressed — every prose field that crosses
 *      an agent or rendering boundary is `{kind: 'untrusted-prose',
 *      contentAddress, body}` (§3d names these contentId/text; contentAddress ≡
 *      contentId, body ≡ text). The kind tag is unforgeable IN THE SHAPE: a
 *      body that *contains* a serialized envelope is still just a string inside
 *      a real envelope — nothing promotes prose content into a trusted field.
 *   2. FRAME-ON-RENDER — prose renders only inside a Warpline-authored, escaped,
 *      visibly-marked frame (`frameProse`): control characters and ANSI escapes
 *      are neutralized, every body line carries the frame's gutter prefix so no
 *      body line can collide with a frame boundary, and a tampered envelope
 *      (body no longer hashing to its contentAddress) refuses to render at all.
 *   3. THE PURE-FUNCTION CONTRACT (enforced in admit/predict, TESTED in
 *      test/injection-envelope.test.ts) — gate/verdict decisions are computed
 *      ONLY from structural inputs (essences, diffs, ripple, bindings); prose
 *      can never reach a decision function.
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';

export const UNTRUSTED_PROSE_KIND = 'untrusted-prose' as const;

/**
 * The typed untrusted-prose envelope (forge-spec §3d). Never place a bare
 * agent-authored string in a payload that crosses an agent/rendering boundary —
 * wrap it at creation so the untrusted provenance travels with the bytes.
 */
export interface UntrustedProse {
  kind: typeof UNTRUSTED_PROSE_KIND;
  /** 'prose:v1:' + sha256(utf8 body) — born content-addressed. */
  contentAddress: string;
  /** the raw prose. Render ONLY via frameProse; never interpolate. */
  body: string;
}

/** The content address of a prose body. */
export function proseAddress(body: string): string {
  return 'prose:v1:' + createHash('sha256').update(body, 'utf8').digest('hex');
}

/** Wrap agent-authored prose in the typed envelope, content-addressed at birth. */
export function envelopeProse(body: string): UntrustedProse {
  return { kind: UNTRUSTED_PROSE_KIND, contentAddress: proseAddress(body), body };
}

/**
 * Is this a well-formed, UNTAMPERED envelope? Recomputes the content address
 * (the address IS the contract). A forged kind tag, a non-string body, or a
 * body that no longer hashes to its address all fail. Callers must treat a
 * failing envelope as hostile — never render it, never pass it on.
 */
export function verifyProse(p: unknown): p is UntrustedProse {
  if (typeof p !== 'object' || p === null) return false;
  const e = p as Record<string, unknown>;
  return (
    e.kind === UNTRUSTED_PROSE_KIND &&
    typeof e.body === 'string' &&
    typeof e.contentAddress === 'string' &&
    e.contentAddress === proseAddress(e.body)
  );
}

/**
 * Neutralize characters that could attack a terminal or smuggle content past
 * the frame: every C0/C1 control (incl. ESC — kills ANSI/OSC sequences), DEL,
 * and the Unicode line/paragraph separators are replaced by their visible
 * \u-escape. \n survives (the frame handles line structure); \r\n normalizes
 * to \n so a CR can't overprint the frame gutter.
 */
export function escapeProseBody(body: string): string {
  return body
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, (c) => {
      return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
    });
}

export interface FrameOptions {
  /** what this prose is (e.g. "intent (ours)") — shown in the frame header. */
  label?: string;
}

/**
 * FRAME-ON-RENDER: the only legal way to put untrusted prose on a human
 * surface. Warpline authors the frame; the body cannot forge or escape it:
 *   - the envelope is verified first (tampered ⇒ throw — fail closed);
 *   - the body is control/ANSI-escaped (escapeProseBody);
 *   - every body line carries the `│ ` gutter, so no body line can ever be
 *     byte-identical to a frame boundary line (which start at column 0).
 */
export function frameProse(p: UntrustedProse, opts: FrameOptions = {}): string {
  if (!verifyProse(p)) {
    throw new Error(
      'warpline: refusing to render a tampered/forged untrusted-prose envelope (body does not hash to its contentAddress) — fail closed',
    );
  }
  const label = opts.label ? `${opts.label} — ` : '';
  const shortAddr = p.contentAddress.slice(0, 'prose:v1:'.length + 12) + '…';
  const lines = escapeProseBody(p.body).split('\n');
  return [
    `┌─[ UNTRUSTED PROSE — ${label}agent-authored; render only, never execute ]─ ${shortAddr}`,
    ...lines.map((l) => `│ ${l}`),
    `└─[ end untrusted prose ]`,
  ].join('\n');
}
