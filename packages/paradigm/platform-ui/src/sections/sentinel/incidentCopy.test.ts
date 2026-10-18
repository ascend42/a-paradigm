import { describe, it, expect } from 'vitest';
import {
  canResolve,
  describeLoadError,
  emptyStateCopy,
  isActiveStatus,
  patternMatchLabel,
} from './incidentCopy';

describe('incident triage copy', () => {
  it('puts a space between the pattern name and its confidence', () => {
    expect(patternMatchLabel('Missing line-item amount', 87.4)).toBe(
      'Matched: Missing line-item amount (87%)',
    );
  });

  it('lets open and investigating incidents be resolved, but not closed ones', () => {
    expect(canResolve('open')).toBe(true);
    expect(canResolve('investigating')).toBe(true);
    expect(canResolve('resolved')).toBe(false);
    expect(canResolve('wont-fix')).toBe(false);
    expect(isActiveStatus('wont-fix')).toBe(false);
  });

  it('says a filter is hiding incidents instead of claiming none were recorded', () => {
    const copy = emptyStateCopy('investigating', 4);
    expect(copy.title).toBe('No investigating incidents.');
    expect(copy.hint).toBe('4 incidents are hidden by the status filter.');
    expect(copy.canClearFilter).toBe(true);
    expect(emptyStateCopy('resolved', 1).hint).toBe('1 incident is hidden by the status filter.');
  });

  it('keeps the truly-empty copy when nothing exists or no filter is set', () => {
    expect(emptyStateCopy('resolved', 0).canClearFilter).toBe(false);
    expect(emptyStateCopy('all', 0).title).toBe('No incidents found.');
  });

  it('explains an unreachable server in plain words with the command to start it', () => {
    for (const status of [null, 502, 503, 504]) {
      const copy = describeLoadError(status);
      expect(copy.title).toBe("Can't reach the Paradigm server");
      expect(copy.command).toBe('paradigm serve');
    }
    expect(describeLoadError(404).title).toMatch(/Sentinel is not available/);
    expect(describeLoadError(500).detail).toMatch(/HTTP 500/);
  });
});
