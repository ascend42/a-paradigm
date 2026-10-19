// The frozen gnomon:approve-voice:v1 preimage (helper 1.6.0, Aegis H1). The vectors are ONE shared fixture,
// test/fixtures/voice-decision-vectors.json, also read by packages/gnomon-helper/darwin/Tests (Swift).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLIENT_API_DESCRIPTOR, parseVoiceDecisionMessage, VOICE_DECISION_FIELDS, voiceDecisionMessage, type VoiceDecisionFields } from '../src/index.js';

interface Vectors {
  valid: Array<{ name: string; message: string; fields: VoiceDecisionFields }>;
  invalid: Array<{ name: string; message: string }>;
}
const V = JSON.parse(readFileSync(new URL('./fixtures/voice-decision-vectors.json', import.meta.url), 'utf8')) as Vectors;

describe('voice decision preimage (frozen with helper 1.6.0)', () => {
  it.each(V.valid.map((v) => [v.name, v] as const))('valid: %s — builds and parses back', (_n, v) => {
    expect(voiceDecisionMessage(v.fields)).toBe(v.message);
    expect(parseVoiceDecisionMessage(v.message)).toEqual(v.fields);
  });

  it.each(V.invalid.map((v) => [v.name, v] as const))('invalid: %s — refused', (_n, v) => {
    expect(parseVoiceDecisionMessage(v.message)).toBeNull();
  });

  it("'-' is refused in every field but the five optional hashes (Arky)", () => {
    const base = V.valid[0]!.fields;
    const optional = ['handleHash', 'challengeHash', 'readbackHash', 'confirmHash', 'answerDigest'];
    for (const k of VOICE_DECISION_FIELDS) {
      const f = { ...base, [k]: '-' };
      if (optional.includes(k)) expect(voiceDecisionMessage(f)).toContain('\n-');
      else expect(() => voiceDecisionMessage(f), k).toThrow(TypeError);
    }
  });

  it('the builder refuses CR, other C0 controls and DEL', () => {
    const base = V.valid[0]!.fields;
    for (const c of ['\r', '\n', '\u0000', '\t', '\u001f', '\u007f']) expect(() => voiceDecisionMessage({ ...base, turnId: `t${c}` })).toThrow(TypeError);
  });

  it('the fixture covers the agreed cases', () => {
    const names = V.invalid.map((v) => v.name).join('|');
    for (const s of ['trailing newline', 'CR', 'NUL', 'DEL', '257 UTF-16', "'-' in armId", "'-' in utteranceHash", "'-' in cardContentHash", "'-' in humanConnId", "'-' in voiceConnId"]) expect(names).toContain(s);
    expect(V.valid.some((v) => v.name.includes('256 UTF-16'))).toBe(true);
  });

  it('is not part of the client API descriptor (clientApiId does not move)', () => {
    expect(JSON.stringify(CLIENT_API_DESCRIPTOR)).not.toContain('gnomon:voice-decision:v1');
  });
});
