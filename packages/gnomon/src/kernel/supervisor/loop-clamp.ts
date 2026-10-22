/**
 * @symbol ^loop-origin-clamp
 * @symbol #loop-runner
 *
 * The loop-origin clamp (docs/specs/gnomon-loops.md §3.4, LL5; build plan step 8), after the voice-origin clamp
 * (voice-clamp.ts, TD-2026-10-21-514). Every loop session opens with `origin:'loop'` (session.open{origin, loopRun}).
 * In those sessions:
 *   - standing grants and the human's `always` rules (exact and prefix), the auto-edits pass and the read-only
 *     passes do NOT apply: loopClampAllows() admits only a modeRef of the loop's OWN trust card
 *     (`loop-trust:<cardId>` or `loop-trust:<cardId>#<rule>`, exact). Default deny, so a modeRef added later is clamped unless added here deliberately.
 *     8.0 has no loop trust rules (act nodes land in step 10), so nothing auto-passes at all;
 *   - every card the session raises carries detail.origin 'loop', detail.loopId, detail.authoredBy and the
 *     kernel-composed first line "Raised by loop X (authored by Y)" (withLoopOrigin);
 *   - the session gets no kernel socket, no session key and no tools (judge and summarize: surface 'none'), so it
 *     has no paradigm_loop write op and no loop.request (LL5: a loop cannot create or widen a loop).
 */
import { wrappedBlock } from '../manifest/install.js';

export const LOOP_ORIGIN = 'loop' as const;

/** May an approval.auto with this modeRef pass inside a loop session? Only the loop's own trust rules (none in 8.0). */
export function loopClampAllows(modeRef: string, trustCardId: string | undefined): boolean {
  if (typeof trustCardId !== 'string' || trustCardId.length === 0) return false;
  // exact: `loop-trust:<cardId>` or `loop-trust:<cardId>#<rule>` (a kebab rule name); never a prefix match
  const base = `loop-trust:${trustCardId}`;
  if (modeRef === base) return true;
  return modeRef.startsWith(`${base}#`) && /^[a-z0-9][a-z0-9-]{0,63}$/.test(modeRef.slice(base.length + 1));
}

/** The kernel-composed first line of a card raised by (or for) a loop. Display-sanitised by the caller's renderer. */
export function loopClampLine(loopId: string, authoredBy: string): string {
  return `Raised by loop ${loopId} (authored by ${authoredBy})`;
}

/** A card plan raised inside a loop session: detail.origin 'loop', the kernel line first, the block rebuilt. */
export function withLoopOrigin<P extends { detail: Record<string, unknown>; lines: string[]; block: Record<string, unknown> }>(plan: P, loop: { loopId: string; runId: string; authoredBy: string }): P {
  const lines = [loopClampLine(loop.loopId, loop.authoredBy), ...plan.lines];
  return { ...plan, detail: { ...plan.detail, origin: LOOP_ORIGIN, loopId: loop.loopId, runId: loop.runId, authoredBy: loop.authoredBy }, lines, block: wrappedBlock(lines).block };
}

/** Kernel names a loop session never gets (no socket, no session key: it talks to nothing but its model endpoint). */
export const LOOP_SESSION_ENV_DROPPED: readonly string[] = Object.freeze(['GNOMON_SOCK', 'GNOMON_SESSION_KEY', 'GNOMON_HSID']);
