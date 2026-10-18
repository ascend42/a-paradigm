/**
 * The client conformance catalog (spec §12.8, §19.1 M1.12; G-CLI-02): the
 * check ids every conformant client must pass, the display vectors every
 * client must reproduce byte for byte, and the report hash a client declares
 * in `hello{client.conformance}`.
 *
 * The runner lives in @a-company/gnomon (src/clients/conformance/) and drives
 * a client through a small language-neutral driver protocol against a LIVE
 * kernel; this package only publishes WHAT is checked, so a community client
 * can read the bar from the package alone. NOT an input to clientApiId.
 *
 * Honest limit (§12.8, threat row 17): the kernel cannot verify a run it did
 * not perform. `status.clients[]` reports what a client DECLARED, labelled
 * `declared`, never `passed`.
 */

import { canonicalJson, sha256Tagged } from './internal.js';
import { eventRow, renderDenominator, sanitizeDisplayText } from './display.js';

export const CONFORMANCE_SUITE = 'gnomon-client-conformance' as const;
export const CONFORMANCE_VERSION = '1' as const;
export const CONFORMANCE_DISPLAY_SCHEMA = 'conformance-display:v1' as const;

export interface ConformanceCheckSpec {
  id: string;
  /** What a conformant client does. */
  must: string;
  spec: string;
  /** `slice-2`: catalogued, not yet run by the runner (reported as `todo`, never as a pass). */
  status: 'run' | 'slice-2';
}

export const CONFORMANCE_CHECKS: readonly ConformanceCheckSpec[] = Object.freeze([
  { id: 'hello.negotiate', must: 'offers gnomon-rpc:v1; the kernel chooses it and reports clientApiId and kitId', spec: '§4.9', status: 'run' },
  { id: 'hello.unsupported', must: 'offering no API the kernel speaks is refused UNSUPPORTED{data.offered}', spec: '§4.9', status: 'run' },
  { id: 'hello.server-sig', must: 'verifies serverSig against the registered kernel key before auth', spec: '§4.9', status: 'run' },
  { id: 'hello.server-sig-mismatch', must: 'a hello signed by any other key is refused locally and NO auth is sent', spec: '§4.9', status: 'run' },
  { id: 'auth.device', must: 'authenticates with a device key (gnomon:auth:v1 over the negotiated hello)', spec: '§4.9', status: 'run' },
  { id: 'auth.device-refused', must: 'an unregistered device key yields ONE AUTH refusal:v1 (-32001) and a closed connection', spec: '§4.9', status: 'run' },
  { id: 'auth.read-token', must: 'authenticates a read token by proof of possession; write verbs are refused FORBIDDEN', spec: '§4.9, §5', status: 'run' },
  { id: 'auth.before-auth', must: 'a known verb before auth yields AUTH{unauthenticated} and the connection closes', spec: '§4.9', status: 'run' },
  { id: 'auth.launch-token', must: 'launch token → GUI token over the WebSocket transport', spec: '§4.9, §11.2', status: 'slice-2' },
  { id: 'auth.reconnect', must: 'Reconnect: {reconnect:true} raises presence and re-pins the kernel key', spec: '§4.9, D54', status: 'slice-2' },
  { id: 'refusal.unknown-verb', must: 'an unknown method yields UNKNOWN_VERB (-32601) carrying a valid refusal:v1', spec: '§4.6, §4.9', status: 'run' },
  { id: 'refusal.bad-request', must: 'malformed params yield BAD_REQUEST (-32600) carrying a valid refusal:v1', spec: '§4.6, §4.9', status: 'run' },
  { id: 'subscribe.since', must: 'log.read{follow, since} delivers the backlog then live rows, in seq order, without gaps', spec: '§4.9', status: 'run' },
  { id: 'subscribe.dropped', must: 'survives socket.subscription.dropped by re-subscribing from since', spec: '§4.9', status: 'slice-2' },
  { id: 'display.sanitize', must: 'every string passes the §4.5 sanitizer incl. the Unicode rules (vectors)', spec: '§4.5', status: 'run' },
  { id: 'display.event-rows', must: 'an unknown modns.* kind renders as an opaque {kind, principal, at} row, never dropped (vectors)', spec: '§4.9', status: 'run' },
  { id: 'display.denominator', must: 'every number renders as {n, of}; a bare count is refused (vectors)', spec: '§9.1', status: 'run' },
  { id: 'cards.kernel-signed', must: 'renders a card only from a kernel-signed approval.request; a forged one never appears', spec: '§12.8 G-CLI-03', status: 'slice-2' },
  { id: 'cards.flags-badge', must: "shows a card's flags badge", spec: '§4.5', status: 'slice-2' },
  { id: 'cards.gesture', must: 'sends approve only on a user gesture', spec: '§12.8', status: 'slice-2' },
  { id: 'kit.image-canvas', must: 'kit.Image renders its alt; kit.Canvas as a surface or the mark list', spec: '§4.5', status: 'slice-2' },
  { id: 'conformance.declared', must: 'a declared conformance tuple appears in status.clients[] labelled declared', spec: '§12.8', status: 'run' },
] satisfies ConformanceCheckSpec[]);

/** Inputs of the display vectors (JS escapes; the JSON file carries the exact code points). */
export const DISPLAY_SANITIZE_INPUTS: readonly string[] = Object.freeze([
  'hello world',
  'tab\tand\nnewline',
  '\u001b]52;c;ZWNobyBwd25lZA==\u0007safe',
  '\u001b]8;;https://evil.example\u001b\\click\u001b]8;;\u001b\\',
  '\u001b[31mred\u001b[0m',
  '\u009b2Jclear',
  '\u001bPq#0;2;0;0;0\u001b\\after',
  'before\u001b_never ends',
  'invoice‮txt.exe',
  'a⁦b⁩c',
  'ap​prove',
  '﻿x⁠y',
  'ok\u{E0041}\u{E0042}',
  'a\u0007b\u0008c',
  'x\u007fy\u0085z',
  'esc\u001bcape',
  '\\u{202E} stays literal',
  '承認 ✅ 👍🏽',
  'rm -rf‮​ /',
]);

export const DISPLAY_ROW_INPUTS: ReadonlyArray<{ kind: string; principal: string; at: string }> = Object.freeze([
  { kind: 'socket.hello', principal: 'p:a1b2c3d4/kernel', at: '2026-10-17T00:00:00.000Z' },
  { kind: 'credit.outcome', principal: 'p:a1b2c3d4/paradigm', at: '2026-10-17T00:00:01.000Z' },
  { kind: 'modns.diff-lens.toggled', principal: 'p:a1b2c3d4/mod-diff-lens', at: '2026-10-17T00:00:02.000Z' },
  { kind: 'modns.diff-lens.note', principal: 'p:a1b2c3d4/mod-‮diff', at: '2026-10-17T00:00:03.000Z' },
  { kind: 'futurens.thing', principal: 'p:a1b2c3d4/ascend', at: '2026-10-17T00:00:04.000Z' },
]);

export const DISPLAY_DENOMINATOR_INPUTS: readonly unknown[] = Object.freeze([{ n: 3, of: 7 }, { n: 0, of: 0 }, 5, { n: 2 }, null]);

export interface DisplayVectors {
  schemaVersion: typeof CONFORMANCE_DISPLAY_SCHEMA;
  sanitize: Array<{ input: string; text: string; flags: string[] }>;
  rows: Array<{ event: { kind: string; principal: string; at: string }; row: ReturnType<typeof eventRow> }>;
  denominators: Array<{ value: unknown; text: string | null }>;
}

/** The display vectors, computed by this package's reference functions (conformance/display.v1.json is their fixed point). */
export function buildDisplayVectors(): DisplayVectors {
  return {
    schemaVersion: CONFORMANCE_DISPLAY_SCHEMA,
    sanitize: DISPLAY_SANITIZE_INPUTS.map((input) => ({ input, ...sanitizeDisplayText(input) })),
    rows: DISPLAY_ROW_INPUTS.map((event) => ({ event: { ...event }, row: eventRow(event) })),
    denominators: DISPLAY_DENOMINATOR_INPUTS.map((value) => {
      try {
        return { value, text: renderDenominator(value) };
      } catch {
        return { value, text: null };
      }
    }),
  };
}

/** How the vectors are written to disk (2-space JSON, ASCII-safe escapes, trailing newline). */
export function serializeDisplayVectors(v: DisplayVectors = buildDisplayVectors()): string {
  // escape every non-ASCII code unit so the file is byte-stable and readable in any editor
  return `${JSON.stringify(v, null, 2).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n`;
}

export interface ConformanceCheckResult {
  id: string;
  result: 'pass' | 'fail' | 'todo';
  detail?: string;
}

export interface ConformanceReport {
  suite: typeof CONFORMANCE_SUITE;
  version: typeof CONFORMANCE_VERSION;
  client: { name: string; version: string; language?: string };
  checks: ConformanceCheckResult[];
  /** true ⇔ every `run` check passed (todo checks never count as passes). */
  pass: boolean;
  reportHash: string;
}

/** reportHash = sha256 over the canonical {suite, version, client, checks} (what a client declares in hello). */
export function conformanceReportHash(r: Pick<ConformanceReport, 'suite' | 'version' | 'client' | 'checks'>): string {
  return sha256Tagged(canonicalJson({ suite: r.suite, version: r.version, client: r.client, checks: r.checks }));
}
