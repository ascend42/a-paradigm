/**
 * @symbol #batch-card
 *
 * #batch-card: the founder's principle (2026-10-23) "grouped cards of related things, one password". One card carries a
 * batch of related changes, so one fresh presence decides them all. Shared by #rules-apply (rules turning back on) and
 * #mcp-servers (servers turning on), so the two batch cards follow ONE set of semantics:
 *
 *   - the caller validates EVERY item before any write or any card (a refusal names the item and writes nothing);
 *   - the card's lines are wrapped (each line under MAX_LINE, never cut) and measured AFTER wrapping;
 *   - over the cap the batch is refused, never cut (the human splits it);
 *   - at allow time the caller re-checks each item and skips, and reports, any that changed while the card waited.
 *
 * The cap is the caller's (MAX_CARD_CHARS, and a count cap of its own). The card body scrolls in the GUI when it is
 * taller than the card's cap (design-system card.body-scroll): a long batch shows in full, never cut, keys in view.
 */
import { wrappedBlock } from '../manifest/install.js';

/** The wrapped card block for these logical lines, and its size in characters (what the card really shows). */
export function batchCardBlock(lines: readonly string[]): { block: Record<string, unknown>; size: number } {
  const w = wrappedBlock(lines);
  const kids = (w.block as { children: Array<{ text: string }> }).children;
  return { block: w.block, size: kids.reduce((k, c) => k + c.text.length + 1, 0) };
}

