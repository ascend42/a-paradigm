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
    expect(CLIENT_API_ID).toBe('sha256:0d6b5f1a43af00225dff0478b85f872e326ee33deae162bddc7bc8e6c4304ee1');
  });
});
