// The frozen gnomon:approve-voice:v1 preimage (helper 1.6.0, Aegis H1). The golden string is shared with
// packages/gnomon-helper/darwin/Tests/gnomon-helper-tests/ArmCustodyTests.swift testH1GoldenMatchesContracts.
import { describe, expect, it } from 'vitest';
import { CLIENT_API_DESCRIPTOR, parseVoiceDecisionMessage, voiceDecisionMessage, type VoiceDecisionFields } from '../src/index.js';

const H64 = `sha256:${'a'.repeat(64)}`;
const ARM = 'arm:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const F: VoiceDecisionFields = {
  cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ',
  decision: 'allow',
  cardContentHash: H64,
  approverPrincipalId: 'p:abcdefgh/matt',
  armId: ARM,
  humanConnId: 'conn:h',
  voiceConnId: 'conn:v',
  turnId: 'turn:1',
  utteranceHash: H64,
  handleHash: '-',
  challengeHash: '-',
  readbackHash: '-',
  confirmHash: '-',
  answerDigest: '-',
};
const GOLDEN = `gnomon:voice-decision:v1\ncard:01HZZZZZZZZZZZZZZZZZZZZZZZ\nallow\n${H64}\np:abcdefgh/matt\n${ARM}\nconn:h\nconn:v\nturn:1\n${H64}\n-\n-\n-\n-\n-`;

describe('voice decision preimage (frozen with helper 1.6.0)', () => {
  it('builds the golden layout and parses it back', () => {
    expect(voiceDecisionMessage(F)).toBe(GOLDEN);
    expect(parseVoiceDecisionMessage(GOLDEN)).toEqual(F);
  });

  it('refuses malformed layouts', () => {
    expect(parseVoiceDecisionMessage(`${GOLDEN}\nextra`)).toBeNull();
    expect(parseVoiceDecisionMessage(GOLDEN.replace('gnomon:voice-decision:v1', 'gnomon:voice-decision:v2'))).toBeNull();
    expect(parseVoiceDecisionMessage(GOLDEN.replace(`turn:1\n${H64}`, 'turn:1\nsha256:zz'))).toBeNull();
    expect(() => voiceDecisionMessage({ ...F, armId: 'a\nb' })).toThrow(TypeError);
    expect(() => voiceDecisionMessage({ ...F, handleHash: '' })).toThrow(TypeError);
  });

  it('is not part of the client API descriptor (clientApiId does not move)', () => {
    expect(JSON.stringify(CLIENT_API_DESCRIPTOR)).not.toContain('gnomon:voice-decision:v1');
  });
});
