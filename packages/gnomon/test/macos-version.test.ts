/**
 * #session-runner macOS floor, on EVERY host (T-2026-10-31-001: the macos-14 runner is retired). The floor reads the
 * major from `sw_vers -productVersion` (parseSwVersMajor, platform/darwin/macos.ts); the darwin session backend refuses
 * sandbox-unavailable {floor: macos, need: 15} below it and {floor: sip} with SIP not plainly enabled — never a weaker
 * profile. This is the injected-version copy of test/session-sandbox.test.ts's live "below the host floor" case.
 */
import { describe, expect, it } from 'vitest';
import { LifecycleRefusal } from '../src/kernel/lifecycle/refusal.js';
import { sessionLaunchPlan, type SessionLaunchInput } from '../src/kernel/sandbox/session.js';
import { parseSwVersMajor } from '../src/platform/darwin/macos.js';

describe('parseSwVersMajor: the macOS major from sw_vers -productVersion', () => {
  it.each([
    ['14.8.9', 14],
    ['15.7.1', 15],
    ['15.7.1\n', 15],
    ['26.1', 26],
    ['', null],
    ['garbage', null],
    ['ProductVersion: 15.7.1', null],
    ['15', null],
  ] as const)('%j -> %s', (text, major) => {
    expect(parseSwVersMajor(text)).toBe(major);
  });
});

describe('the darwin session backend below the floor (injected probes, every host)', () => {
  // the floor is checked before the input is read: no world is needed
  const input = {} as SessionLaunchInput;
  const refusal = (fn: () => unknown): LifecycleRefusal => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(LifecycleRefusal);
      return e as LifecycleRefusal;
    }
    throw new Error('expected a refusal');
  };

  it('macOS 14 refuses sandbox-unavailable (floor macos, need 15), never a weaker profile', () => {
    const e = refusal(() => sessionLaunchPlan(input, 'darwin', () => 14, () => true));
    expect(e.reason).toBe('sandbox-unavailable');
    expect(e.detail).toMatchObject({ profile: 'session', floor: 'macos', have: 14, need: 15 });
  });

  it('an unknown version fails closed (floor macos)', () => {
    expect(refusal(() => sessionLaunchPlan(input, 'darwin', () => parseSwVersMajor('garbage'), () => true)).detail).toMatchObject({ floor: 'macos', have: null, need: 15 });
  });

  it('macOS 15 with SIP off refuses at the SIP floor', () => {
    const e = refusal(() => sessionLaunchPlan(input, 'darwin', () => 15, () => false));
    expect(e.reason).toBe('sandbox-unavailable');
    expect(e.detail).toMatchObject({ floor: 'sip', have: 'disabled' });
  });
});
