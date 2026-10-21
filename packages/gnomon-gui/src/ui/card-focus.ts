/**
 * @symbol #gui-toast
 *
 * Finding the ONE card a toast key (Restart now, Make it standing, Re-pin) or another caller asks to focus. Mika's
 * review of batch notices-and-toasts: focusCard once fell back to any gate-class card when its card was missing, so
 * "Make it standing" or "Restart now" could focus a different card. It now matches the exact cardId or nothing; a
 * missing card is a warn naming the card that was asked for, never a different card.
 */

interface PileLike {
  querySelectorAll(sel: string): ArrayLike<{ getAttribute(name: string): string | null }>;
}

/** The card element with exactly this cardId in the pile, or null (never another card). */
export function cardIn<T extends { getAttribute(name: string): string | null }>(pile: { querySelectorAll(sel: string): ArrayLike<T> } & PileLike, cardId: string): T | null {
  const all = pile.querySelectorAll('.card[data-card-id]');
  for (let i = 0; i < all.length; i++) if (all[i]!.getAttribute('data-card-id') === cardId) return all[i]!;
  return null;
}

/** What a caller calls the card it focuses (the warn names it when it has not arrived yet). */
export type CardLabel = 'upgrade card' | 'grant card' | 're-pin card' | 'voice card' | 'Touch ID card' | 'card';

export const notArrivedText = (what: CardLabel): string => `the ${what} has not arrived yet; it shows in the stack when it does`;
