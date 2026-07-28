/**
 * #f4-trace (CLI skin) — the CLI arm's emission side of `f4Trace:v1`
 * (T-2026-07-21-005; mcp-skin-spec §5). The F4 falsifier scores BOTH skins
 * independently, so the CLI must produce the same measurement stream the MCP
 * skin does; until this module existed `cli.ts` emitted no rows at all and the
 * CLI arm was structurally unmeasurable.
 *
 * ONE SHAPE, THREE SKINS — so a CLI row names the DAEMON VERB it corresponds
 * to, never the commander command path. That keeps the classifier (which reads
 * `verb`) arm-agnostic: `warpline admit --native` and the `warpline_admit` tool
 * are the same verb observed through different skins.
 *
 * CLI-ONLY commands (ones with no daemon verb) emit under a `cli:` prefix so
 * they are VISIBLE in the transcript without being silently folded into a verb
 * they are not. `warpline status` is the load-bearing case: it is the working
 * tree's MEANING DIFF, which is a different thing from the daemon's `status`
 * (position in the write cycle + next legal verbs), and conflating them would
 * hand the classifier's orientation allowance to a call that teaches an agent
 * nothing about what to do next.
 *
 * TWO KNOWN COVERAGE GAPS on this arm, surfaced rather than papered over:
 *   - `status` (daemon, cycleStage 'orient') — the state-aware self-description
 *     carrier D4 calls load-bearing has NO CLI equivalent. `warpline status` is
 *     a semantic diff; nothing on the CLI answers "what may I legally do next".
 *   - `shadow.tail` — no CLI command reads shadow verdict rows (`admit --shadow`
 *     WRITES one; it does not tail them).
 * Both are design decisions for the founder, not wiring bugs: closing either
 * one changes VERB_DESCRIPTORS and therefore resets the FG-3 denominator.
 *
 * PRINCIPAL, and how this arm differs from MCP: the MCP skin's principal is the
 * token's, server-stamped by the daemon. The native CLI verbs run in-process
 * with no token, so the principal recorded here is the one the COMMAND ASSERTS
 * (its agentId) — SELF-ASSERTED, not authenticated. It is honest for
 * measurement and must never be read as attribution.
 *
 * Library code: no console output. Emission is best-effort and never changes
 * the command's own exit code or output.
 */

import { F4Tracer, resultClassOf } from '../daemon/f4-trace.js';
import { RefusedError, type Refusal } from '../fabric/refusal.js';

/** The traced CLI surface: command → the daemon verb it is the CLI skin of. */
export const CLI_VERB_MAP = {
  'refs list': 'refs.list',
  fork: 'fork',
  propose: 'propose',
  admit: 'admit',
  'knot show': 'knot.show',
  grade: 'grade.report',
  /** CLI-only — the meaning diff, NOT the daemon's cycle-position `status`. */
  status: 'cli:status',
} as const;

/**
 * Structural request summary — the `targetOf` discipline, mirroring the MCP
 * skin's `targetOfParams`: selectors, identities and flags ONLY.
 *
 * PROSE MUST NEVER REACH THIS FUNCTION. On the CLI the prose-bearing inputs are
 * `--intent`/`-m` and the inline `--claim <json>` BODY (which embeds an intent);
 * call sites pass neither. Values are emitted verbatim, so the caller owns the
 * choice of what is a selector.
 */
export function cliTarget(
  strings: Record<string, string | undefined>,
  flags: Record<string, boolean | undefined> = {},
): string | null {
  const bits: string[] = [];
  for (const [k, v] of Object.entries(strings)) if (typeof v === 'string' && v) bits.push(`${k}=${v}`);
  for (const [k, v] of Object.entries(flags)) if (v === true) bits.push(k);
  return bits.length ? bits.join(' ') : null;
}

/** the refusal riding INSIDE a result (the verdict-class refusals audit masks). */
function refusalOf(result: unknown): Refusal | undefined {
  if (result && typeof result === 'object' && 'refusal' in result) {
    return (result as { refusal?: Refusal }).refusal ?? undefined;
  }
  return undefined;
}

/**
 * Run one CLI command body under the trace. Emits exactly one row — ok with the
 * result's structural class and any result-borne refusal, or not-ok on a throw
 * — then returns or RE-THROWS unchanged, so `fail()` still owns exit behavior.
 *
 * A thrown error that is not a `RefusedError` emits a row with NO refusal: that
 * is the honest record of a cold agent receiving prose instead of a
 * machine-readable refusal, and it is exactly the residue T-2026-07-21-003
 * still tracks on the CLI error paths.
 */
export async function traceCli<T>(
  spec: { root: string; verb: string; target: string | null; principal?: string },
  run: () => Promise<T> | T,
): Promise<T> {
  const tracer = new F4Tracer(spec.root, 'cli', spec.principal ?? 'cli');
  try {
    const result = await run();
    tracer.emit({
      verb: spec.verb,
      target: spec.target,
      ok: true,
      refusal: refusalOf(result),
      resultClass: resultClassOf(result),
    });
    return result;
  } catch (err) {
    tracer.emit({
      verb: spec.verb,
      target: spec.target,
      ok: false,
      ...(err instanceof RefusedError ? { refusal: err.refusal } : {}),
    });
    throw err;
  }
}
