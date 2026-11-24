/**
 * #gui-gesture (boards S1.3, draft point 2; Aegis A1): the gesture stamp's token rules.
 */
import { describe, expect, it } from 'vitest';
import { GESTURE_FANOUT, GESTURE_KINDS, GESTURE_MAX_AGE_MS, gestureOf, gestureProblem, gestureUsesLeft, takeGesture } from '../src/core/gesture.js';
import type { Gesture } from '../src/core/gesture.js';

const trusted = (type: string, extra: Record<string, unknown> = {}): { isTrusted: boolean; type: string } => ({ isTrusted: true, type, ...extra });

describe('#gui-gesture gestureOf', () => {
  it('mints a stamp only for a trusted pointerup, keydown, click or paste', () => {
    expect(gestureOf(trusted('pointerup'), 5)).toMatchObject({ kind: 'pointer', at: 5, n: 0 });
    expect(gestureOf(trusted('keydown'), 5)?.kind).toBe('key');
    expect(gestureOf(trusted('click'), 5)?.kind).toBe('menu');
    expect(gestureOf(trusted('paste'), 5)?.kind).toBe('paste');
    for (const type of ['pointerdown', 'pointermove', 'keyup', 'mousedown', 'input', 'drop', 'copy', 'toString', '__proto__', '']) expect(gestureOf(trusted(type), 5)).toBeNull();
    for (const type of ['pointerup', 'keydown', 'click', 'paste']) {
      expect(gestureOf({ isTrusted: false, type }, 5)).toBeNull();
      expect(gestureOf({ isTrusted: 1 as unknown as boolean, type }, 5)).toBeNull();
    }
    expect(gestureOf(trusted('keydown', { repeat: true }), 5)).toBeNull();
    expect(gestureOf(trusted('keydown'), Number.NaN)).toBeNull();
    expect(GESTURE_KINDS).toEqual(['pointer', 'key', 'paste', 'menu']);
  });

  it('numbers a stamp at its first use, one above the last one sent, however many were minted and never sent', () => {
    const a = gestureOf(trusted('click'), 0)!;
    expect(takeGesture(a, 0)).toBeNull();
    const first = a.n;
    expect(first).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 5000; i++) gestureOf(trusted('pointerup'), 0);
    const b = gestureOf(trusted('keydown'), 0)!;
    expect(b.n).toBe(0);
    expect(takeGesture(b, 1)).toBeNull();
    expect(b.n).toBe(first + 1);
    expect(takeGesture(b, 2)).toBeNull();
    expect(b.n).toBe(first + 1);
    expect(Object.isFrozen(b)).toBe(true);
    expect(Object.keys(b).sort()).toEqual(['at', 'kind', 'n']);
  });

  it('may ride on four commands and no more', () => {
    const g = gestureOf(trusted('pointerup'), 100)!;
    expect(gestureUsesLeft(g, 100)).toBe(GESTURE_FANOUT);
    for (let i = 0; i < GESTURE_FANOUT; i++) expect(takeGesture(g, 100 + i)).toBeNull();
    expect(takeGesture(g, 105)).toBe('spent');
    expect(gestureUsesLeft(g, 105)).toBe(0);
  });

  it('is not sent once it is older than ten seconds, or dated in the future', () => {
    const g = gestureOf(trusted('pointerup'), 1000)!;
    expect(gestureProblem(g, 1000 + GESTURE_MAX_AGE_MS)).toBeNull();
    expect(takeGesture(g, 1000 + GESTURE_MAX_AGE_MS + 1)).toBe('expired');
    expect(takeGesture(g, 999)).toBe('expired');
    expect(gestureUsesLeft(g, 1000)).toBe(GESTURE_FANOUT);
  });

  it('a stamp sent before a later one is not sent again (its number would go backwards)', () => {
    const a = gestureOf(trusted('click'), 0)!;
    const b = gestureOf(trusted('click'), 0)!;
    expect(takeGesture(a, 0)).toBeNull();
    expect(takeGesture(b, 0)).toBeNull();
    expect(takeGesture(a, 0)).toBe('superseded');
    expect(takeGesture(b, 0)).toBeNull();
  });

  it('null and a look-alike object are missing: only a stamp gestureOf minted counts', () => {
    expect(takeGesture(null, 0)).toBe('missing');
    expect(takeGesture(undefined, 0)).toBe('missing');
    const real = gestureOf(trusted('click'), 0)!;
    expect(takeGesture({ n: 1, kind: 'pointer', at: 0 } as Gesture, 0)).toBe('missing');
    expect(takeGesture({ ...real }, 0)).toBe('missing');
    expect(gestureProblem(real, 0)).toBeNull();
  });
});
