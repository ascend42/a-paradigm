/**
 * @symbol #gui
 *
 * #gui transcript stickiness (founder rule, dogfood 2026-10-19). PURE, so the
 * scroll behaviour is unit-tested without a browser:
 *   1. At the bottom (within `BOTTOM_SLACK_PX`) the feed is STUCK: new rows,
 *      and the user's own sent message, keep it at the bottom.
 *   2. Scrolled up to read, NOTHING moves it: not a new row, not a send.
 *   3. While scrolled up a "↓ latest" key shows the count of items that
 *      arrived since; clicking it jumps to the bottom and sticks again, and
 *      scrolling back to the bottom by hand does the same.
 * The page asks `isAtBottom` on every user scroll and `shouldStick` before it
 * paints; it scrolls only when stuck, and otherwise keeps the reading
 * position anchored to the row in view (re-renders never jump).
 */

/** How close to the bottom still counts as "at the bottom" (a fractional scroll, a 1-2 px rounding). */
export const BOTTOM_SLACK_PX = 24;

export function isAtBottom(scrollTop: number, clientHeight: number, scrollHeight: number, slack = BOTTOM_SLACK_PX): boolean {
  return scrollTop + clientHeight >= scrollHeight - slack;
}

export class Follow {
  #stuck = true;
  #unseen = 0;

  /** True ⇒ the next paint scrolls to the bottom. */
  get shouldStick(): boolean {
    return this.#stuck;
  }

  /** Items that arrived while scrolled up (the "↓ latest" count). */
  get unseen(): number {
    return this.#unseen;
  }

  /** The "↓ latest" key shows exactly while scrolled up. */
  get showJump(): boolean {
    return !this.#stuck;
  }

  /**
   * A scroll the USER made (never one the page made itself). Moving up always unsticks, however small the step
   * (the slack only decides re-sticking), so a gentle wheel tick near the bottom is never snapped back (founder
   * dogfood 2026-10-19). Reaching the bottom while moving down sticks again and clears the count.
   */
  onScroll(atBottom: boolean, movedUp = false): void {
    if (movedUp) this.#stuck = false;
    else if (atBottom) {
      this.#stuck = true;
      this.#unseen = 0;
    } else this.#stuck = false;
  }

  /** Intent to read back (wheel up, touch drag down, ArrowUp / PageUp / Home): unstick before the next paint can snap. */
  release(): void {
    this.#stuck = false;
  }

  /** `n` items appended (a row arrived or the user sent): counted only while scrolled up; never changes stickiness. */
  onAppend(n: number): void {
    if (n > 0 && !this.#stuck) this.#unseen += n;
  }

  /** The "↓ latest" key, or a new transcript (focus): stick and clear. */
  jump(): void {
    this.#stuck = true;
    this.#unseen = 0;
  }
}
