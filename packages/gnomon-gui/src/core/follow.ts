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
 *
 * Founder report 2026-10-23 ("it doesn't keep the scrolling to the bottom even though I've been at the bottom and
 * haven't moved it"): stickiness changes ONLY on the user's own scroll intent (a wheel, a scroll key, a touch, focus
 * moving into the transcript, a pointer held on it: its scrollbar), never on a scroll the layout made. WebKit (the
 * Gnomon.app wrapper) clamps the transcript's scrollTop when the composer shrinks or re-measures (fitComposer resets
 * its height to measure it; the ghost line and the dictation bar come and go), and fires that scroll BEFORE the
 * ResizeObserver repaint, so it read as "the user moved up" and unstuck the feed on nearly every dictated word.
 * `scrollEvent` is the scroll handler's whole decision, pure, so that sequence is a unit test.
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

/** How long one gesture counts as the user's scroll intent after it (a wheel tick and its momentum, a key's smooth scroll). */
export const INTENT_MS = Object.freeze({ wheel: 300, key: 700, focus: 400, pointer: 300, touch: 1000 });

/**
 * The user's scroll intent: a gesture marks a short window (`mark`), and a pointer or finger held on the transcript
 * (dragging its scrollbar, a touch scroll) holds it until let go plus a short tail (momentum, the last frame).
 */
export class ScrollIntent {
  #until = Number.NEGATIVE_INFINITY;
  #held = false;

  mark(now: number, ms: number): void {
    this.#until = Math.max(this.#until, now + ms);
  }

  hold(): void {
    this.#held = true;
  }

  letGo(now: number, ms: number = INTENT_MS.pointer): void {
    if (!this.#held) return;
    this.#held = false;
    this.mark(now, ms);
  }

  active(now: number): boolean {
    return this.#held || now <= this.#until;
  }
}

export interface ScrollEventView {
  /** the viewport's scrollTop now */
  top: number;
  /** the page's own last scroll write (setScroll) */
  selfTop: number;
  /** scrollTop at the previous scroll event */
  lastTop: number;
  clientHeight: number;
  scrollHeight: number;
  /** the user is making this scroll (ScrollIntent.active) */
  byUser: boolean;
}

/**
 * One scroll event: 'own' (the page's write echoing back), 'user' (stickiness follows it: up unsticks, reaching the
 * bottom sticks) or 'layout' (a scroll nobody chose: a clamp when the transcript grew or the composer re-measured;
 * stickiness is unchanged and the repaint that follows puts a stuck feed back at the bottom).
 */
export function scrollEvent(f: Follow, e: ScrollEventView): 'own' | 'user' | 'layout' {
  if (Math.abs(e.top - e.selfTop) < 1) return 'own';
  if (!e.byUser) return 'layout';
  f.onScroll(isAtBottom(e.top, e.clientHeight, e.scrollHeight), e.top < e.lastTop - 0.5);
  return 'user';
}
