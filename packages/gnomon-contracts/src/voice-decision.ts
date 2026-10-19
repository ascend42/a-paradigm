/**
 * The voice decision preimage: the message signed under `gnomon:approve-voice:v1` (spec §14.7, A26-04 "arm, turn,
 * utterance, handle, challenge, readback and confirm hashes in the preimage"; G-BRK-06; helper 1.6.0 Aegis H1).
 * FROZEN with helper 1.6.0: the signed helper parses it (packages/gnomon-helper/darwin/Sources/gnomon-helper/
 * Protocol.swift parseVoiceDecision) and refuses to sign unless `armId`, `humanConnId` and `voiceConnId` name the
 * arm the signature is requested under. Changing the layout needs a new marker and a new helper.
 *
 * NOT part of CLIENT_API_DESCRIPTOR (no client builds or verifies it: the broker signs it, the kernel verifies it),
 * so this module never moves clientApiId.
 *
 * Layout (the domain line `gnomon:approve-voice:v1\n` is prepended by the signer, signaturePreimage):
 *   gnomon:voice-decision:v1    marker
 *   cardId                      card:<ULID>
 *   decision                    a card decision
 *   cardContentHash             sha256:<hex64>
 *   approverPrincipalId         the arming human
 *   armId                       arm:<ULID>
 *   humanConnId                 the arming (human) connection
 *   voiceConnId                 the paired voice connection
 *   turnId                      the voice turn
 *   utteranceHash               sha256:<hex64> of the normalized utterance
 *   handleHash                  sha256:<hex64> | -   (gate and judgment cards)
 *   challengeHash               sha256:<hex64> | -   (gate and judgment cards)
 *   readbackHash                sha256:<hex64> | -
 *   confirmHash                 sha256:<hex64> | -   (two-step confirm: the hash of the NORMALIZED CONFIRM
 *                                                     utterance, a second utterance; distinct from challengeHash,
 *                                                     the hash of the kernel's secret challenge words)
 *   answerDigest                sha256:<hex64> | -   (ask-user answer text)
 * Exactly 15 lines joined by `\n` (0x0A), no trailing newline. No field is empty, contains a C0 control
 * (U+0000–U+001F, so no `\n` and no `\r`) or DEL (U+007F), or is longer than VOICE_DECISION_FIELD_MAX UTF-16 code
 * units (JS `length`; the helper measures the same way). `-` (absent) is accepted ONLY for handleHash,
 * challengeHash, readbackHash, confirmHash and answerDigest (lines 10–14 after the marker); it is refused in every
 * other field. Shared vectors: packages/gnomon-contracts/test/fixtures/voice-decision-vectors.json (read by this
 * package's tests and the helper's Swift tests).
 *
 * V8a OBLIGATION: the kernel broker MUST build the message it asks the helper to sign with voiceDecisionMessage()
 * and MUST verify a voice decision signature over a message re-parsed with parseVoiceDecisionMessage(); never a
 * hand-joined string.
 */
export const VOICE_DECISION_MARKER = 'gnomon:voice-decision:v1' as const;
export const VOICE_DECISION_FIELD_MAX = 256;
export const VOICE_DECISION_FIELDS = [
  'cardId',
  'decision',
  'cardContentHash',
  'approverPrincipalId',
  'armId',
  'humanConnId',
  'voiceConnId',
  'turnId',
  'utteranceHash',
  'handleHash',
  'challengeHash',
  'readbackHash',
  'confirmHash',
  'answerDigest',
] as const;
export type VoiceDecisionFields = Record<(typeof VOICE_DECISION_FIELDS)[number], string>;

const HASH = /^sha256:[0-9a-f]{64}$/;
/** Fields that are a hash or `-` (absent); utteranceHash and cardContentHash must be a hash. */
const OPTIONAL_HASHES = new Set(['handleHash', 'challengeHash', 'readbackHash', 'confirmHash', 'answerDigest']);

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function fieldOk(name: string, v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > VOICE_DECISION_FIELD_MAX || CONTROL.test(v)) return false;
  if (name === 'cardContentHash' || name === 'utteranceHash') return HASH.test(v);
  if (OPTIONAL_HASHES.has(name)) return v === '-' || HASH.test(v);
  return v !== '-'; // absent is never allowed outside the optional hashes
}

/** Build the message (without the domain line). Throws TypeError on a malformed field. */
export function voiceDecisionMessage(f: VoiceDecisionFields): string {
  for (const k of VOICE_DECISION_FIELDS) if (!fieldOk(k, f[k])) throw new TypeError(`voice decision: bad ${k}`);
  return [VOICE_DECISION_MARKER, ...VOICE_DECISION_FIELDS.map((k) => f[k])].join('\n');
}

/** Parse a message (without the domain line); null when it is not exactly the frozen layout. */
export function parseVoiceDecisionMessage(m: string): VoiceDecisionFields | null {
  const parts = m.split('\n');
  if (parts.length !== VOICE_DECISION_FIELDS.length + 1 || parts[0] !== VOICE_DECISION_MARKER) return null;
  const out = {} as VoiceDecisionFields;
  for (let i = 0; i < VOICE_DECISION_FIELDS.length; i++) {
    const k = VOICE_DECISION_FIELDS[i]!;
    const v = parts[i + 1];
    if (!fieldOk(k, v)) return null;
    out[k] = v;
  }
  return out;
}
