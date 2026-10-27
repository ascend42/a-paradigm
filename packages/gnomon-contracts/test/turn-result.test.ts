/**
 * review M2: turn.result{turn} names the latest turn it closes (a folded queued turn closes with it); a row without it
 * pairs FIFO. Published in the client API descriptor (the deliberate clientApiId move).
 */
import { describe, expect, it } from 'vitest';
import { CLIENT_API_DESCRIPTOR, CLIENT_API_ID, TURN_ID_PATTERN, TURN_RESULT_PAIRING } from '../src/index.js';

describe('review M2: turn.result{turn}', () => {
  it('the pairing rule rides the client API descriptor', () => {
    expect(TURN_RESULT_PAIRING).toEqual({ key: 'turn', pattern: TURN_ID_PATTERN.source, closesThrough: true, absent: 'fifo' });
    expect((CLIENT_API_DESCRIPTOR as Record<string, unknown>).turnResult).toEqual(TURN_RESULT_PAIRING);
    expect(Object.isFrozen(TURN_RESULT_PAIRING)).toBe(true);
  });
  it('the clientApiId moved once for it', () => {
    expect(CLIENT_API_ID).toBe('sha256:04cbb3581136ee3409f404d42648284fd392bdf8302131b39edd07fd414941ff');
  });
});
