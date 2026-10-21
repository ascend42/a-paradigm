/**
 * M1.1 reservations (spec v3.9 §4.11 "Reserved in M1.1", §19.1 M1.1 row;
 * §4.9 / A26-11: values the next release needs are reserved one release
 * before, so `clientApiId` does not move in Move 2 or Move 4).
 *
 * COVERAGE APPROACH (parse, not hand-list): the test reads docs/specs/gnomon.md
 * and extracts every backticked token from (a) the §4.11 "Reserved in M1.1"
 * list and (b) the §19.1 M1.1 row from "the P8-D58 values reserved" up to "and
 * the id rules of §4.2" (the D58, R9 and D86–D88 parentheticals). Every token
 * must have an entry in COVERAGE below, and every entry must be a token the
 * spec still lists — so a value added to the spec's reservation list without a
 * contract fails CI, and so does a stale entry. Parsing was chosen over a
 * hand-copied list because a hand list silently drifts from the spec; the
 * token map is still hand-written, because one token can carry several meanings
 * (`strictness` is a card kind, a card field and a refusal gate) and each
 * meaning is asserted. Tokens the contracts package cannot or must not carry
 * are explicit GAP entries with the reason, and the gap set is pinned.
 *
 * LIMIT: only backticked tokens are seen. A value the spec names in plain prose
 * (e.g. "refusal gate `link` and its reasons") is not a token; such lists are
 * checked by dedicated parsers below (§4.6's link reasons) or pinned elsewhere
 * (voice reasons: refusal-rpc.test.ts counts §14.7's 25 + voice-strictness).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CARD_KINDS,
  CARD_STATES,
  CARD_FLAGS,
  CARD_DECISIONS,
  CARD_V1_KEYS,
  CARD_RESERVED_VALUES,
  PRESENCE_VALUES,
  VIA_VALUES,
  APPROVE_VOICE_SIG_DOMAIN,
  STRICTNESS_LEVELS,
  RUN_MODES,
  ROOT_CONFIG_RESERVED_SECTIONS,
  REFUSAL_CODES,
  REFUSAL_GATES,
  REFUSAL_REASONS,
  SOCKET_REASON_ROUTES,
  RESERVED_KIND_PAYLOADS,
  FAIL_SAFE_VALUES,
  GRANT_DERIVED_ONLY_CAPABILITIES,
  failSafeStrictnessLevel,
  failSafeRunMode,
  failSafeRiskTier,
  failSafeAgentRevertHow,
  failSafeKernelRevertHow,
  failSafeFindingSeverity,
  failSafeFindingResponse,
  hasUnknownFailSafeValue,
  RETRIABILITIES,
  VOICE_REFUSAL_REASONS,
  LINK_REFUSAL_REASONS,
  RESERVED_REASON_ROUTES,
  AUDIENCES,
  SENSITIVITIES,
  EVENT_KINDS,
  EVENT_KIND_NAMES,
  INJECT_ORIGINS,
  SESSION_TAINTS,
  APPROVAL_SUSPECT_REASONS,
  RESERVED_PAYLOAD_FIELDS,
  PRINCIPAL_KINDS,
  REGISTRY_ROW_KINDS,
  GRANT_ROW_KINDS,
  CAPABILITY_FORMS,
  FIRST_PARTY_ONLY_CAPABILITIES,
  REF_SCHEMES,
  VERBS,
  ADDITIVE_ENUMS,
  VERB_PARAM_VALUES,
  RESERVED_CONTENT_PARTS,
  STATUS_RESERVED_FIELDS,
  CONTRACT_SCHEMAS,
  CLIENT_API_DESCRIPTOR,
  CLIENT_API_ID,
  FINDING_RESPONSES,
  isCardDecidable,
  refuse,
  validateCardV1,
  validateRefusalV1,
  validateEventV1,
  validateChangeNoteV1,
  validateReviewFindingV1,
  validateFindingResponses,
  defaultLabelsFor,
  renderEnumValue,
} from '../src/index.js';
import { jsonSchemaErrors } from './helpers.js';
import * as F from './fixtures.js';

/* ── spec extraction ──────────────────────────────────────────────────────── */

const spec = readFileSync(fileURLToPath(new URL('../../../docs/specs/gnomon.md', import.meta.url)), 'utf8');
const ticks = (t: string) => [...t.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

function section411(): string {
  const a = spec.indexOf('**Reserved in M1.1**');
  const b = spec.indexOf('\n---', a);
  if (a < 0 || b < 0) throw new Error('§4.11 "Reserved in M1.1" list not found');
  return spec.slice(a, b);
}
function m11Row(): string {
  const row = spec.split('\n').find((l) => l.startsWith('| M1.1 '));
  if (!row) throw new Error('§19.1 M1.1 row not found');
  const a = row.indexOf('the P8-D58 values reserved');
  const b = row.indexOf('and the id rules of §4.2');
  if (a < 0 || b < 0) throw new Error('M1.1 row reservation span not found');
  return row.slice(a, b);
}
const SPEC_TOKENS = [...new Set([...ticks(section411()), ...ticks(m11Row())])];

/* ── the coverage map: token → assertion of every meaning, or GAP ─────────── */

const has = (list: readonly string[], ...v: string[]) => v.every((x) => list.includes(x));
const kind = (...k: string[]) => k.every((x) => !!EVENT_KINDS[x]);
const reservedAs = (tag: string, ...k: string[]) => k.every((x) => EVENT_KINDS[x]?.reserved === tag);
const ns = (prefix: string, tag: string) => {
  const ks = EVENT_KIND_NAMES.filter((k) => k.startsWith(prefix));
  return ks.length > 0 && ks.some((k) => EVENT_KINDS[k]!.reserved === tag);
};
const D58 = 'M1.1:P8-D58';
const R9 = 'M1.1:P8-R9';
const D86 = 'M1.1:P8-D86-D88';
const param = (verb: string, p: string) => VERBS.find((v) => v.verb === verb)!.params.includes(p);
const payload = (k: string, ...f: string[]) => f.every((x) => RESERVED_PAYLOAD_FIELDS[k]?.[x] !== undefined);

type Entry = (() => boolean) | { gap: string };
const COVERAGE: Record<string, Entry> = {
  // meta: the thing the reservations protect
  clientApiId: () => /^sha256:[0-9a-f]{64}$/.test(CLIENT_API_ID),

  // P8-D58 (voice approvals, §14.7)
  'voice-arm': () => has(CARD_KINDS, 'voice-arm'),
  grant: () => has(CARD_KINDS, 'grant'),
  held: () => has(CARD_STATES, 'held') && has(VOICE_REFUSAL_REASONS, 'held'),
  withdraw: () => has(CARD_DECISIONS, 'withdraw'),
  'voice-phrase': () => has(CARD_FLAGS, 'voice-phrase'),
  'presence: voice-armed': () => has(PRESENCE_VALUES, 'voice-armed'),
  via: () => has(CARD_V1_KEYS, 'via') && has(VIA_VALUES, 'voice'),
  voice: () => has(CARD_V1_KEYS, 'voice') && has(REFUSAL_GATES, 'voice') && has(VIA_VALUES, 'voice'),
  voiceDecision: () => has(CARD_V1_KEYS, 'voiceDecision'),
  'gnomon:approve-voice:v1': () => APPROVE_VOICE_SIG_DOMAIN === 'gnomon:approve-voice:v1',
  'approval.voice.*': () => ns('approval.voice.', D58),
  'request.*': () => reservedAs(D58, 'request.grant', 'request.voice.arm', 'request.voice.narrow'),

  // P8-R9 (kernel linking, §3.9)
  handoff: () => has(CARD_KINDS, 'handoff'),
  declassify: () => has(CARD_KINDS, 'declassify'),
  'peer-pair': () => has(CARD_KINDS, 'peer-pair'),
  peer: () => has(CARD_FLAGS, 'peer') && has(REF_SCHEMES, 'peer') && has(PRINCIPAL_KINDS, 'peer') && VERBS.every((v) => 'peer' in v.access),
  'via: link': () => has(VIA_VALUES, 'link'),
  'principal.kind: peer': () => has(PRINCIPAL_KINDS, 'peer') && has(ADDITIVE_ENUMS['principal.kind'], 'peer'),
  'session.inject.origin: peer': () => has(INJECT_ORIGINS, 'peer'),
  taint: () => has(SESSION_TAINTS, 'none', 'peer', 'peer-teammate') && payload('session.tainted', 'taint'),
  briefId: () => payload('session.inject', 'briefId', 'peerRootKeyId'),
  'session.open.brief': () => param('session.open', 'brief?'),
  '{brief}': () => has(RESERVED_CONTENT_PARTS, 'brief'),
  link: () => has(REFUSAL_GATES, 'link') && has(REGISTRY_ROW_KINDS, 'link') && LINK_REFUSAL_REASONS.length > 0,
  'link.*': () => ns('link.', R9),
  'request.brief.send': () => reservedAs(R9, 'request.brief.send'),
  'request.cowork.allow': () => reservedAs(R9, 'request.cowork.allow'),
  'request.link.revoke': () => reservedAs(R9, 'request.link.revoke'),
  'status.links': () => 'links' in STATUS_RESERVED_FIELDS,
  'grant.peer': () => has(GRANT_ROW_KINDS, 'grant.peer'),
  'link:send': () => has(CAPABILITY_FORMS, 'link:send') && has(FIRST_PARTY_ONLY_CAPABILITIES, 'link:send'),
  'permit.log': { gap: 'permit:v1 (§4.8) is not yet a contract in gnomon-contracts; its `log` field lands with the permit schema (#budget-fuse)' },
  'brief:v1': { gap: 'drafted under linkApiId, never part of clientApiId (§3.9); deferred with M2.8 (P8-D77)' },
  'cowork.msg:v1': { gap: 'drafted under linkApiId, never part of clientApiId (§3.9); deferred with M2.8 (P8-D77)' },
  'gnomon-link:v1': { gap: 'peer protocol under linkApiId, not a client API (§3.9); deferred with M2.8 (P8-D77)' },
  linkApiId: { gap: 'hashes gnomon-link:v1 frames, frozen like modAbiId; not computed until the link schemas exist (P8-D77)' },

  // P8-D86–D88 (§4.11): cards
  reconsider: () => has(CARD_KINDS, 'reconsider'),
  strictness: () => has(CARD_KINDS, 'strictness') && has(CARD_V1_KEYS, 'strictness') && has(REFUSAL_GATES, 'strictness'),
  incident: () => has(CARD_KINDS, 'incident'),
  extend: () => has(CARD_DECISIONS, 'extend'),
  restart: () => has(CARD_DECISIONS, 'restart'),
  irreversible: () => has(CARD_FLAGS, 'irreversible'),
  'claim-mismatch': () => has(CARD_FLAGS, 'claim-mismatch'),
  'note?: change-note:v1': () => has(CARD_V1_KEYS, 'note'),
  note: () => has(CARD_V1_KEYS, 'note') && param('contract.claim', 'note?'),
  'strictness?{level, mode, reason}': () => has(CARD_V1_KEYS, 'strictness') && STRICTNESS_LEVELS.length === 4 && RUN_MODES.length === 3,
  // refusals
  review: () => has(REFUSAL_GATES, 'review'),
  'review-cap': () => has(REFUSAL_REASONS, 'review-cap') && RESERVED_REASON_ROUTES['review-cap']!.gate === 'review',
  'strictness-presence': () => RESERVED_REASON_ROUTES['strictness-presence']!.gate === 'strictness',
  'strictness-paused': () => RESERVED_REASON_ROUTES['strictness-paused']!.gate === 'strictness',
  'strictness-mode': () => RESERVED_REASON_ROUTES['strictness-mode']!.gate === 'strictness',
  'strictness-evidence': () => RESERVED_REASON_ROUTES['strictness-evidence']!.gate === 'strictness',
  'voice-strictness': () => has(VOICE_REFUSAL_REASONS, 'voice-strictness') && RESERVED_REASON_ROUTES['voice-strictness']!.gate === 'voice',
  // Arky's name, folded into voice-strictness by the spec: must NOT be reserved.
  'strictness-voice': () => !REFUSAL_REASONS.includes('strictness-voice' as never),
  'note-missing': () => RESERVED_REASON_ROUTES['note-missing']!.code === 'BAD_REQUEST',
  // an existing closed code: unchanged (no code is added)
  BAD_REQUEST: () => has(REFUSAL_CODES, 'BAD_REQUEST') && REFUSAL_CODES.length === 17,
  'approval.suspect': () => kind('approval.suspect'),
  'strictness-class': () => has(APPROVAL_SUSPECT_REASONS, 'strictness-class'),
  // schemas and verb params
  'review-finding:v1': () => 'review-finding.v1.schema.json' in CONTRACT_SCHEMAS,
  'change-note:v1': () => 'change-note.v1.schema.json' in CONTRACT_SCHEMAS,
  'contract.claim': () => param('contract.claim', 'note?') && param('contract.claim', 'responses?'),
  responses: () => param('contract.claim', 'responses?'),
  'responses: [{fid, response: fixed|wrong|intentional|immaterial, note?}]': () =>
    has(FINDING_RESPONSES, 'fixed', 'wrong', 'intentional', 'immaterial') &&
    has(VERB_PARAM_VALUES['contract.claim.responses[].response'], ...FINDING_RESPONSES),
  'session.open': () => param('session.open', 'runMode?'),
  'runMode?': () => param('session.open', 'runMode?'),
  'session.open.runMode': () => has(VERB_PARAM_VALUES['session.open.runMode'], 'manual', 'ask', 'auto-edits'),
  // event kinds
  'approval.strictness.raised|proposed|lowered|held': () =>
    reservedAs(D86, 'approval.strictness.raised', 'approval.strictness.proposed', 'approval.strictness.lowered', 'approval.strictness.held'),
  'approval.strictness.*': () => ns('approval.strictness.', D86),
  'approval.mode.set': () => reservedAs(D86, 'approval.mode.set'),
  'approval.auto': () => reservedAs(D86, 'approval.auto'),
  'contract.review.returned|capped|extended|restarted': () =>
    reservedAs(D86, 'contract.review.returned', 'contract.review.capped', 'contract.review.extended', 'contract.review.restarted'),
  'contract.review.*': () => ns('contract.review.', D86),
  'merge.reverted': () => reservedAs(D86, 'merge.reverted'),
  'merge.ref.rewritten': () => reservedAs(D86, 'merge.ref.rewritten'),
  'verdict.incident': () => reservedAs(D86, 'verdict.incident'),
  'request.strictness.set': () => reservedAs(D86, 'request.strictness.set'),
  'request.mode.set': () => reservedAs(D86, 'request.mode.set'),
  'request.incident': () => reservedAs(D86, 'request.incident'),
  // additive fields on existing kinds
  'oracle.result': () => payload('oracle.result', 'round', 'range', 'findings'),
  round: () => payload('oracle.result', 'round'),
  'range{from, to}': () => payload('oracle.result', 'range'),
  'findings[]': () => payload('oracle.result', 'findings'),
  'contract.knot': () => payload('contract.knot', 'reopenOf'),
  reopenOf: () => payload('contract.knot', 'reopenOf'),
  'verdict.founder': () => payload('verdict.founder', 'override'),
  override: () => payload('verdict.founder', 'override'),
  // status and root config
  'status.strictness': () => 'strictness' in STATUS_RESERVED_FIELDS,
  'status.review': () => 'review' in STATUS_RESERVED_FIELDS,
  'status.unobservedRefWrites': () => 'unobservedRefWrites' in STATUS_RESERVED_FIELDS,
  'strictness:': () => has(ROOT_CONFIG_RESERVED_SECTIONS, 'strictness'),
  'review:': () => has(ROOT_CONFIG_RESERVED_SECTIONS, 'review'),
};

/** Update ONLY on a deliberate client-API change (and record it in the review). */
// Moved once by P8-D89 (M1.4 slice 3, T-2026-10-18-002): was sha256:8e30f400…3014.
// Moved once by P8-D93 (T-2026-10-18-016: hello clientNonce + session.compacted): was sha256:fd576e6d…e0fd.
// Moved once by P8-D98 (T-2026-10-19-001: human-device verbs, drain/resume + cursor + claim reservations): was sha256:1faf47f5…8720.
// Moved once by TD-2026-10-19-194 (voice V0, founder ruling: VOICE_DISARM_REASONS, voice-strictness ceiling, status.arms/armCustody): was sha256:f27ecb8b…11a4.
// Moved once by TD-2026-10-19-063 (self-update pickup, founder ruling "ONE Touch ID": the GUI resume auth form + gui.resume): was sha256:99d5c152…97d1.
// Moved once by 8.0:TD-2026-10-20-812 (the Desk: offer kinds + offer-spec:v1 + mute + in-GUI install; the context meter's threshold + restart): was sha256:69e8db86…cc0e.
// Moved once by 8.0:T-2026-10-21-006 (founder ruling: offer.suppressed on the signed log + desk.suppress closed values): was sha256:4d883058…ccd8.
// Moved once by review M2 (turn.result{turn} + descriptor turnResult): was sha256:eda8c627…1114.
// Moved once by 8.0:T-2026-10-21-008 (re-review M-1/M-2: offer.retired + session.anomaly + desk.retire/sessionAnomaly closed values): was sha256:4c2b9371…af2c.
const PINNED_CLIENT_API_ID = 'sha256:454cd632007a77540a4526bebb55384d40e7935ad677e5dd9bf185595c77e4de';

const EXPECTED_GAPS = ['permit.log', 'brief:v1', 'cowork.msg:v1', 'gnomon-link:v1', 'linkApiId'];

describe('M1.1 reservation list is fully covered (parsed from docs/specs/gnomon.md §4.11 + §19.1 M1.1)', () => {
  it('the spec spans were found and are non-trivial', () => {
    expect(SPEC_TOKENS.length).toBeGreaterThan(80);
  });
  it('every token the spec reserves has a coverage entry', () => {
    expect(SPEC_TOKENS.filter((t) => !(t in COVERAGE))).toEqual([]);
  });
  it('no stale coverage entries (every entry is still listed by the spec)', () => {
    expect(Object.keys(COVERAGE).filter((t) => !SPEC_TOKENS.includes(t))).toEqual([]);
  });
  for (const [token, entry] of Object.entries(COVERAGE)) {
    if (typeof entry === 'function') it(`reserved: \`${token}\``, () => expect(entry()).toBe(true));
  }
  it('the unrepresented set is exactly the documented gaps', () => {
    expect(Object.entries(COVERAGE).filter(([, e]) => typeof e !== 'function').map(([t]) => t).sort()).toEqual([...EXPECTED_GAPS].sort());
  });
});

describe('every P8-D86–D88 value validates', () => {
  it('each new card kind, decision and flag passes strict validation', () => {
    for (const k of ['reconsider', 'strictness', 'incident']) expect(validateCardV1({ ...F.goodCard, kind: k })).toEqual([]);
    for (const d of ['extend', 'restart']) {
      expect(validateCardV1({ ...F.reconsiderCard, state: 'held', heldUntil: F.goodCard.timeoutAt, heldDecision: d })).toEqual([]);
      // never on any other kind (strict producer rule)
      expect(validateCardV1({ ...F.goodCard, state: 'held', heldUntil: F.goodCard.timeoutAt, heldDecision: d }).join()).toMatch(/only on a reconsider card/);
    }
    for (const f of ['irreversible', 'claim-mismatch']) expect(validateCardV1({ ...F.goodCard, flags: [f] })).toEqual([]);
    for (const level of STRICTNESS_LEVELS) {
      for (const mode of RUN_MODES) expect(validateCardV1({ ...F.goodCard, strictness: { level, mode, reason: 'r' } })).toEqual([]);
    }
    expect(CARD_RESERVED_VALUES['M1.1:P8-D86-D88'].kind).toEqual(['reconsider', 'strictness', 'incident']);
  });
  it('extend/restart are decidable only on a reconsider card', () => {
    expect(isCardDecidable({ state: 'pending', kind: 'reconsider' }, 'extend')).toBe(true);
    expect(isCardDecidable({ state: 'pending', kind: 'reconsider' }, 'restart')).toBe(true);
    expect(isCardDecidable({ state: 'pending', kind: 'knot' }, 'extend')).toBe(false);
    expect(isCardDecidable({ state: 'pending', kind: 'strictness' }, 'restart')).toBe(false);
    expect(isCardDecidable({ state: 'pending', kind: 'strictness' }, 'allow')).toBe(true);
    // kind unknown or omitted ⇒ reconsider-only decisions are never decidable
    expect(isCardDecidable({ state: 'pending' }, 'extend')).toBe(false);
    expect(isCardDecidable({ state: 'pending' }, 'restart')).toBe(false);
    expect(isCardDecidable({ state: 'pending', kind: 'reconsider-v2' }, 'extend')).toBe(false);
  });
  it('strict producers require the claim-mismatch and irreversible flags (G-CHG-01, G-CHG-04)', () => {
    for (const [, card] of F.badCardsNoteFlags) {
      expect(validateCardV1(card).join()).toMatch(/requires the (claim-mismatch|irreversible) flag/);
      expect(validateCardV1(card, { mode: 'tolerant' })).toEqual([]);
    }
    expect(validateCardV1(F.reconsiderCard)).toEqual([]);
  });
  it('strict effective tier EQUALS max(kernel floor, agent tier) (§3.4)', () => {
    const over = { ...F.goodChangeNote, kernel: { ...F.goodChangeNote.kernel, risk: { floor: 'low', effective: 'high', reasons: [] } } };
    expect(validateChangeNoteV1(over, { form: 'card' }).join()).toMatch(/must equal max/);
    expect(validateChangeNoteV1(over, { form: 'card', mode: 'tolerant' })).toEqual([]);
  });
  it('each reserved refusal reason validates on its gate and code', () => {
    for (const [reason, { code, gate }] of Object.entries(RESERVED_REASON_ROUTES)) {
      const r = refuse({ code, gate, data: { reason } });
      expect(validateRefusalV1(r)).toEqual([]);
      expect(r.gate).toBe(gate);
    }
  });
  it('each reserved event kind validates, is kernel-owned, private + normal by default (§9.1, S32 §6)', () => {
    const d86 = EVENT_KIND_NAMES.filter((k) => EVENT_KINDS[k]!.reserved === D86);
    expect(d86.sort()).toEqual(
      [
        'approval.strictness.raised', 'approval.strictness.proposed', 'approval.strictness.lowered', 'approval.strictness.held',
        'approval.mode.set', 'approval.auto',
        'contract.review.returned', 'contract.review.capped', 'contract.review.extended', 'contract.review.restarted',
        'merge.reverted', 'merge.ref.rewritten', 'verdict.incident',
        'request.strictness.set', 'request.mode.set', 'request.incident',
      ].sort(),
    );
    for (const k of d86) {
      expect(EVENT_KINDS[k]!.owner).toBe('kernel');
      expect(defaultLabelsFor(k)).toEqual({ audience: 'private', sensitivity: 'normal' });
      expect(validateEventV1({ ...F.minimalEvent, kind: k }, { checkDefaultLabels: true })).toEqual([]);
    }
    // oracle.result keeps its sensitive evidence field label (findings ride beside it).
    expect(EVENT_KINDS['oracle.result']!.fieldLabels).toEqual({ evidence: 'sensitive' });
  });
  it('contract.claim responses validate; unknown response refused', () => {
    expect(validateFindingResponses([{ fid: 'f-1', response: 'fixed' }, { fid: 'f-2', response: 'intentional', note: 'by design' }])).toEqual([]);
    expect(validateFindingResponses([{ fid: 'f-1', response: 'ignored' }]).length).toBeGreaterThan(0);
  });
  it('additive enums carry the new values (renderEnumValue knows them)', () => {
    for (const [name, v] of [
      ['card.kind', 'reconsider'], ['card.kind', 'strictness'], ['card.kind', 'incident'],
      ['decision', 'extend'], ['decision', 'restart'],
      ['card.flags', 'irreversible'], ['card.flags', 'claim-mismatch'],
      ['refusal.gate', 'review'], ['refusal.gate', 'strictness'],
      ['refusal.reason', 'review-cap'], ['refusal.reason', 'strictness-presence'], ['refusal.reason', 'strictness-paused'],
      ['refusal.reason', 'strictness-mode'], ['refusal.reason', 'strictness-evidence'], ['refusal.reason', 'voice-strictness'],
      ['refusal.reason', 'note-missing'],
    ] as const) {
      expect(renderEnumValue(name, v).known).toBe(true);
    }
  });
});

describe('closed enumerations are untouched (§4.9: code, retriable, audience, sensitivity)', () => {
  it('no value added to any closed enumeration', () => {
    expect(REFUSAL_CODES).toHaveLength(17);
    expect([...RETRIABILITIES]).toEqual(['retry-identical', 'retry-corrected', 'retry-after-rebase', 'retry-after-resolve', 'retry-with-override', 'never']);
    expect([...AUDIENCES]).toEqual(['private', 'team', 'org']);
    expect([...SENSITIVITIES]).toEqual(['normal', 'sensitive', 'secret']);
  });
});

describe('unknown-value tolerance still holds on the new surface', () => {
  it('a future card kind/decision/flag is refused strict, accepted tolerant (TS + JSON Schema)', () => {
    const future = { ...F.reconsiderCard, kind: 'quorum', flags: ['sparkles'], state: 'held', heldUntil: F.goodCard.timeoutAt, heldDecision: 'defer' };
    expect(validateCardV1(future).length).toBeGreaterThan(0);
    expect(validateCardV1(future, { mode: 'tolerant' })).toEqual([]);
    expect(jsonSchemaErrors(CONTRACT_SCHEMAS['card.v1.schema.json']!, future, true)).toEqual([]);
  });
  it('a future refusal gate/reason is tolerated by clients', () => {
    const r = refuse({ code: 'FORBIDDEN', gate: 'review', data: { reason: 'review-future' } });
    expect(validateRefusalV1({ ...r, gate: 'quorum' }, { mode: 'tolerant' })).toEqual([]);
    expect(validateRefusalV1(r, { mode: 'tolerant' })).toEqual([]);
  });
  it('unknown fields inside a change note or finding are tolerated by clients, refused by producers', () => {
    const note = { ...F.goodChangeNote, kernel: { ...F.goodChangeNote.kernel, future: 1 } };
    expect(validateChangeNoteV1(note, { form: 'card' }).length).toBeGreaterThan(0);
    expect(validateChangeNoteV1(note, { form: 'card', mode: 'tolerant' })).toEqual([]);
    const finding = { ...F.goodFinding, future: 1 };
    expect(validateReviewFindingV1(finding).length).toBeGreaterThan(0);
    expect(validateReviewFindingV1(finding, { mode: 'tolerant' })).toEqual([]);
  });
  it('fail-safe readings: unknown ⇒ the strictest known value', () => {
    expect(failSafeStrictnessLevel('L9')).toBe('L3');
    expect(failSafeStrictnessLevel('L1')).toBe('L1');
    expect(failSafeRunMode('bypass')).toBe('manual');
    expect(failSafeRunMode('ask')).toBe('ask');
    expect(failSafeRiskTier('none')).toBe('high');
    expect(failSafeRiskTier('low')).toBe('low');
    expect(failSafeAgentRevertHow('exec')).toBe('manual');
    expect(failSafeKernelRevertHow('rollback')).toBe('none');
    expect(failSafeFindingSeverity('blocker')).toBe('important');
    expect(failSafeFindingSeverity('nit')).toBe('nit');
    expect(failSafeFindingResponse('ignored')).toBeUndefined();
    expect(failSafeFindingResponse('fixed')).toBe('fixed');
    expect(FAIL_SAFE_VALUES).toEqual({
      'card.strictness.level': 'L3', 'run.mode': 'manual', 'risk.tier': 'high', 'agentClaims.revert.how': 'manual',
      'kernel.revert.how': 'none', 'finding.severity': 'important', 'finding.response': null,
    });
  });
  it('a card with an unknown fail-safe value renders (tolerant + JSON Schema tolerant) but is never decidable', () => {
    const unknowns = [
      { ...F.goodCard, strictness: { level: 'L4', mode: 'ask', reason: 'x' } },
      { ...F.goodCard, strictness: { level: 'L0', mode: 'bypass', reason: 'x' } },
      { ...F.reconsiderCard, note: { ...F.goodChangeNote, agentClaims: { ...F.goodAgentClaims, risk: { ...F.goodAgentClaims.risk, tier: 'critical' } } } },
      { ...F.reconsiderCard, note: { ...F.goodChangeNote, agentClaims: { ...F.goodAgentClaims, revert: { ...F.goodAgentClaims.revert, how: 'exec' } } } },
      { ...F.reconsiderCard, note: { ...F.goodChangeNote, kernel: { ...F.goodChangeNote.kernel, risk: { floor: 'severe', effective: 'high', reasons: [] } } } },
      { ...F.reconsiderCard, note: { ...F.goodChangeNote, kernel: { ...F.goodChangeNote.kernel, revert: { how: 'rollback' } } } },
    ];
    for (const card of unknowns) {
      expect(validateCardV1(card).length).toBeGreaterThan(0);
      expect(validateCardV1(card, { mode: 'tolerant' })).toEqual([]);
      expect(jsonSchemaErrors(CONTRACT_SCHEMAS['card.v1.schema.json']!, card, true)).toEqual([]);
      expect(hasUnknownFailSafeValue(card as any)).toBe(true);
      for (const d of ['allow', 'deny', 'accept', 'reject', 'extend', 'restart']) expect(isCardDecidable(card as any, d)).toBe(false);
    }
    expect(isCardDecidable(F.reconsiderCard as any, 'extend')).toBe(true);
  });
  it('unknown finding severity / response render tolerant, refused strict', () => {
    expect(validateReviewFindingV1({ ...F.goodFinding, severity: 'blocker' }, { mode: 'tolerant' })).toEqual([]);
    expect(validateReviewFindingV1({ ...F.goodFinding, severity: 'blocker' }).length).toBeGreaterThan(0);
    expect(validateFindingResponses([{ fid: 'f', response: 'ignored' }], { mode: 'tolerant' })).toEqual([]);
  });
});

describe('change-note:v1 keeps agentClaims apart from kernel fields (B16, §4.11)', () => {
  it('the claim form (contract.claim{note}) is agentClaims only; a kernel part is refused even tolerant', () => {
    expect(validateChangeNoteV1(F.claimFormChangeNote, { form: 'claim' })).toEqual([]);
    expect(validateChangeNoteV1(F.goodChangeNote, { form: 'claim' }).join()).toMatch(/computed by the kernel/);
    expect(validateChangeNoteV1(F.goodChangeNote, { form: 'claim', mode: 'tolerant' }).length).toBeGreaterThan(0);
  });
  it('the card form requires the kernel part', () => {
    expect(validateChangeNoteV1(F.goodChangeNote, { form: 'card' })).toEqual([]);
    expect(validateChangeNoteV1(F.claimFormChangeNote, { form: 'card' }).join()).toMatch(/kernel/);
  });
  it('form is required: no default, an unknown form is refused', () => {
    expect(validateChangeNoteV1(F.goodChangeNote, {} as any).join()).toMatch(/form must be/);
    expect(validateChangeNoteV1(F.goodChangeNote, { form: 'agent' } as any).join()).toMatch(/form must be/);
  });
  it('the two published forms (JSON Schema): claim refuses a kernel part even tolerant; card requires it', () => {
    const s = CONTRACT_SCHEMAS['change-note.v1.schema.json'] as any;
    const claim = { ...s.$defs.claim, $defs: s.$defs };
    const card = { ...s.$defs.card, $defs: s.$defs };
    expect(jsonSchemaErrors(claim, F.claimFormChangeNote)).toEqual([]);
    expect(jsonSchemaErrors(claim, F.goodChangeNote).length).toBeGreaterThan(0);
    expect(jsonSchemaErrors(claim, F.goodChangeNote, true).length).toBeGreaterThan(0);
    expect(jsonSchemaErrors(card, F.goodChangeNote)).toEqual([]);
    expect(jsonSchemaErrors(card, F.claimFormChangeNote).length).toBeGreaterThan(0);
    expect(jsonSchemaErrors(card, F.claimFormChangeNote, true).length).toBeGreaterThan(0);
    // card:v1.note is the card form; contract.claim.note points at the claim form
    expect((CONTRACT_SCHEMAS['card.v1.schema.json'] as any).properties.note).toEqual(s.$defs.card);
    expect(VERB_PARAM_VALUES['contract.claim.note']).toEqual(['change-note.v1.schema.json#/$defs/claim']);
  });
  it('kernel-only fields cannot be smuggled into agentClaims', () => {
    const smuggled = { ...F.goodChangeNote, agentClaims: { ...F.goodAgentClaims, verified: { n: 9, of: 9 }, effective: 'low' } };
    expect(validateChangeNoteV1(smuggled, { form: 'card' }).join()).toMatch(/agentClaims: unknown property "verified"/);
  });
  it('an agent can raise its tier, never lower the effective one', () => {
    const lowered = { ...F.goodChangeNote, kernel: { ...F.goodChangeNote.kernel, risk: { floor: 'low', effective: 'low', reasons: [] } } };
    expect(validateChangeNoteV1(lowered, { form: 'card' }).join()).toMatch(/agent's claimed tier/);
  });
  it('the published schema marks the two parts with their trust', () => {
    const s = CONTRACT_SCHEMAS['change-note.v1.schema.json'] as any;
    expect(s.$defs.card.properties.agentClaims['x-gnomon-trust']).toMatch(/^untrusted/);
    expect(s.$defs.card.properties.kernel['x-gnomon-trust']).toMatch(/^kernel-computed/);
    expect(s.$defs.claim.properties.kernel).toBe(false);
  });
});

describe('clientApiId covers the reservations', () => {
  it('the descriptor carries the non-schema reservations', () => {
    expect(CLIENT_API_DESCRIPTOR.verbParamValues).toBe(VERB_PARAM_VALUES);
    expect(CLIENT_API_DESCRIPTOR.contentParts).toBe(RESERVED_CONTENT_PARTS);
    expect(CLIENT_API_DESCRIPTOR.statusFields).toBe(STATUS_RESERVED_FIELDS);
  });
  it('clientApiId is pinned to its exact literal (any accidental move fails CI)', () => {
    // pre-M1.1-part-2: sha256:0ee09159ee64af9fc8d81938c81791a366207118a078d6e5280586025a5429a6; round 2: 493467f5… (before reason renames)
    expect(CLIENT_API_ID).toBe(PINNED_CLIENT_API_ID);
  });
});

describe('prose-named reason lists (beyond the backtick limit)', () => {
  it('§4.6 link reasons equal LINK_REFUSAL_REASONS', () => {
    const a = spec.indexOf('### 4.6 refusal');
    const sec = spec.slice(a, spec.indexOf('### 4.7', a));
    const m = /`link` \(§3\.9: `FORBIDDEN` with `data\.reason` ∈ `([^`]+)`; `UNSUPPORTED` with `([^`]+)`\)/.exec(sec);
    expect(m).not.toBeNull();
    expect([...m![1]!.split(/\s+/), m![2]!]).toEqual([...LINK_REFUSAL_REASONS]);
  });
});

describe('kernel socket reasons (M1.4 addendum) are reserved and routed', () => {
  it('every socket reason is in REFUSAL_REASONS and validates on its code and gate', () => {
    for (const [reason, { code, gate }] of Object.entries(SOCKET_REASON_ROUTES)) {
      expect(REFUSAL_REASONS).toContain(reason);
      const r = refuse({ code, data: { reason } });
      expect(r.gate).toBe(gate); // the route's gate is the code's default gate (§4.6)
      expect(validateRefusalV1(r)).toEqual([]);
    }
  });
  it('the requested list is covered exactly, incl. framing.ts malformed-* (utf8, json, not-object)', () => {
    const requested = [
      'unauthenticated', 'not-implemented', 'matrix', 'hello-params', 'hello-repeated', 'no-shared-client-api', 'unknown-device',
      'bad-signature', 'principal-mismatch', 'foreign-principal', 'root-unprovisioned', 'nonce-expired', 'nonce-used',
      'already-authenticated', 'replayed-transcript', 'no-hello', 'auth-params', 'token-not-implemented', 'web-auth-not-implemented',
      'log-write-failed', 'unknown-verb', 'rpc-tag', 'jsonrpc-version', 'frame-too-large',
      'malformed-utf8', 'malformed-json', 'malformed-not-object',
    ];
    // also emitted by the socket code (renamed per ruling: id→request-id, method→method-missing, peer→peer-not-client)
    expect(Object.keys(SOCKET_REASON_ROUTES).sort()).toEqual(
      [
        ...requested,
        'request-id',
        'method-missing',
        'peer-not-client',
        'response-too-large',
        'internal',
        // M1.4 slice 3 (P8-D89, the one batched clientApiId move): read tokens, gone, log.append ownership
        'unknown-token',
        'token-expired',
        'token-revoked',
        'token-in-use',
        'token-not-yet-valid',
        'token-store-untrusted',
        'gone',
        'kernel-owned',
        'ungranted',
        'modns-not-own',
        'bad-kind',
        'bad-params',
        // P8-D89 round 3: reasons the kernel already sent since slice 2
        'follow-needs-id',
        'backlog-too-large',
        'bad-since',
        'bad-until',
        'bad-limit',
        'bad-follow',
        'bad-kinds',
        'bad-scope',
        'since-ahead',
        'subscription-cap',
        'mod-principal-name',
        'reader-unsupported',
        'bad-ref',
        'rev-not-applicable',
        'unknown-scheme',
        'peer-ref',
        'no-resolver',
        'not-found',
        'row-integrity',
        'closed',
      ].sort(),
    );
    // ruling (b): client-local, never a wire reason; old names never reserved
    for (const gone of ['connection-closed', 'id', 'method', 'peer']) expect(REFUSAL_REASONS).not.toContain(gone);
  });
  it('no reason is listed twice across the reason families', () => {
    expect(new Set(REFUSAL_REASONS).size).toBe(REFUSAL_REASONS.length);
  });
});

describe('event labels and payload docs (round 2)', () => {
  it('socket.disconnect is registered kernel-owned, private + normal (§9.1 socket row, v3.8)', () => {
    expect(EVENT_KINDS['socket.disconnect']).toMatchObject({ owner: 'kernel', sensitivity: 'normal' });
    expect(EVENT_KINDS['socket.disconnect']!.reserved).toBeUndefined();
  });
  it('session.open gains runMode as a reserved payload field', () => {
    expect(RESERVED_PAYLOAD_FIELDS['session.open']).toMatchObject({ runMode: D86 });
  });
  it('approval.auto carries inputHash, never the tool input; row private + normal, field path sensitive (Aegis)', () => {
    const f = RESERVED_KIND_PAYLOADS['approval.auto']!;
    expect(f).toContain('inputHash');
    for (const banned of ['tool_input', 'input', 'toolInput', 'content']) expect(f).not.toContain(banned);
    expect(defaultLabelsFor('approval.auto')).toEqual({ audience: 'private', sensitivity: 'normal' });
    expect(f).toContain('path');
    // T-2026-10-20-007 (TD-2026-10-20-086): the anchored command's digest is a sensitive field too
    expect(EVENT_KINDS['approval.auto']!.fieldLabels).toEqual({ path: 'sensitive', inputHash: 'sensitive', anchoredInputHash: 'sensitive' });
  });
  it('merge.reverted: row private + normal, field trailer sensitive (Aegis)', () => {
    expect(RESERVED_KIND_PAYLOADS['merge.reverted']).toContain('trailer');
    expect(defaultLabelsFor('merge.reverted')).toEqual({ audience: 'private', sensitivity: 'normal' });
    expect(EVENT_KINDS['merge.reverted']!.fieldLabels).toEqual({ trailer: 'sensitive' });
  });
  it('the field-label table is exactly the §9.1 entries plus the Aegis additions (incl. the M1.4 round-3 content-digest audit)', () => {
    const labelled = Object.fromEntries(EVENT_KIND_NAMES.filter((k) => EVENT_KINDS[k]!.fieldLabels).map((k) => [k, EVENT_KINDS[k]!.fieldLabels]));
    expect(labelled).toEqual({
      'approval.request': { tool_input: 'sensitive' },
      'oracle.result': { evidence: 'sensitive' },
      'voice.turn.user': { audioRef: 'sensitive' },
      'approval.auto': { path: 'sensitive', inputHash: 'sensitive', anchoredInputHash: 'sensitive' },
      'approval.auto.miss': { why: 'sensitive', inputHash: 'sensitive' }, // T-2026-10-20-007
      'merge.reverted': { trailer: 'sensitive' },
      'turn.sent': { contentHash: 'sensitive' },
      'approval.voice.arm': { phrasesHash: 'sensitive' },
      'approval.voice.intent': { handleHash: 'sensitive', challengeHash: 'sensitive' },
      'link.msg.out': { hash: 'sensitive' },
      'inject.receipt': { shas: 'sensitive', source_hash: 'sensitive', frozenSliceHash: 'sensitive' },
      'daemon.log.quarantined': { evidencePath: 'sensitive' }, // P8-D89 reservation (a local path)
      'session.compacted': { summaryHash: 'sensitive' }, // P8-D93: digest of model-written summary text
    });
  });
  it('incident kinds carry no free-text field, so no sensitive field label is needed', () => {
    expect(RESERVED_KIND_PAYLOADS['verdict.incident']).toEqual(['cardId', 'refs', 'severity']);
    expect(RESERVED_KIND_PAYLOADS['request.incident']).toEqual(['refs', 'severity']);
    expect(EVENT_KINDS['verdict.incident']!.fieldLabels).toBeUndefined();
    expect(EVENT_KINDS['request.incident']!.fieldLabels).toBeUndefined();
  });
  it('every reserved D86 kind has a payload doc', () => {
    const d86 = EVENT_KIND_NAMES.filter((k) => EVENT_KINDS[k]!.reserved === D86);
    const d89 = EVENT_KIND_NAMES.filter((k) => EVENT_KINDS[k]!.reserved === 'M1.4:P8-D89');
    const standing = EVENT_KIND_NAMES.filter((k) => EVENT_KINDS[k]!.reserved === '8.0:TD-2026-10-20-086');
    expect(Object.keys(RESERVED_KIND_PAYLOADS).sort()).toEqual([...d86, ...d89, ...standing].sort());
  });
  it('voice.approve:<class> is grant-derived only: never in any manifest, first-party included', () => {
    expect(GRANT_DERIVED_ONLY_CAPABILITIES).toEqual(['voice.approve:<class>']);
  });
});
