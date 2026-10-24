/**
 * JSON Schemas (draft 2020-12) for the PR-3 contracts, BUILT FROM the TS
 * constants so the two cannot drift. `schemas/*.json` are generated from these
 * objects (`npm run schemas`, scripts/write-schemas.mjs) and a test asserts the
 * committed files are byte-identical to the build (fixed point, cf. G-HON-04).
 *
 * The schemas express the STRICT (producer) form. Enums that are additive under
 * §4.9 carry `"x-gnomon-additive": true`; a consumer applying the
 * compatible-additive rule ignores `enum` on those nodes and `additionalProperties:false`
 * everywhere (unknown fields are ignored, unknown values rendered opaquely).
 */

import { ISO_DATE_TIME, SHA256_TAGGED, deepFreeze } from './internal.js';
import { ID_PATTERNS, HSID_PATTERN, KEY_ID_PATTERN, REPO_SCOPE_PATTERN, CONTRACT_ID_PATTERN } from './ids.js';
import { ANY_PRINCIPAL_PATTERN, DEVICE_ID_PATTERN } from './principal.js';
import { REF_V1_JSON_PATTERN, REF_SCHEMES } from './ref.js';
import {
  AUDIENCES,
  SENSITIVITIES,
  KIND_PATTERN,
  EVENT_KIND_NAMES,
  EVENT_KINDS,
  EVENT_V1_REQUIRED,
  OPEN_USERLAND_NAMESPACES,
  RESERVED_PAYLOAD_FIELDS,
  SESSION_TAINTS,
  APPROVAL_SUSPECT_REASONS,
  RESERVED_KIND_PAYLOADS,
  KIND_PAYLOADS,
  COMPACTION_REASONS,
} from './event.js';
import {
  RISK_TIERS,
  AGENT_REVERT_HOWS,
  KERNEL_REVERT_HOWS,
  CHANGE_NOTE_LIMITS,
  CHANGE_NOTE_AGENT_KEYS,
  CHANGE_NOTE_KERNEL_KEYS,
} from './change-note.js';
import { FINDING_SEVERITIES, FINDING_RESPONSES, LINE_RANGE_PATTERN, REVIEW_FINDING_V1_KEYS } from './review-finding.js';
import {
  REFUSAL_CODES,
  REFUSAL_GATES,
  RETRIABILITIES,
  MAX_CONTESTED,
  NEXT_PRINCIPALS,
  CONTESTED_RANKS,
  OVERRIDE_FLAGS,
  REFUSAL_REASONS,
  REFUSAL_V1_REQUIRED,
} from './refusal.js';
import {
  CARD_KINDS,
  CARD_STATES,
  CARD_FLAGS,
  CARD_DECISIONS,
  PRESENCE_VALUES,
  VIA_VALUES,
  VOICE_ELIGIBILITY,
  VOICE_INELIGIBLE_REASONS,
  VOICE_ARM_CLASSES,
  VOICE_MODES,
  HANDOFF_DIRECTIONS,
  CARD_V1_REQUIRED,
  STRICTNESS_LEVELS,
  RUN_MODES,
} from './card.js';
import { CLIENT_NONCE_PATTERN_SOURCE, CLIENT_SURFACES, HELLO_RESULT_KEYS } from './rpc.js';
import {
  APP_ZIP_ARCHES,
  ARTIFACT_VERSION_PATTERN,
  RELEASE_APP_ZIP_V1_KEYS,
  RELEASE_ARCHES,
  RELEASE_ARTIFACT_NAMES,
  RELEASE_ARTIFACT_V1_KEYS,
  RELEASE_ARTIFACTS_MAX,
  RELEASE_MANIFEST_V1,
  RELEASE_MANIFEST_V1_KEYS,
  RELEASE_REQUIREMENT_MAX,
  RELEASE_VERSION_PATTERN,
  SHA256_HEX_PATTERN,
} from './release-manifest.js';
import { CONTEXT_SOURCES, OFFER_LIMITS, OFFER_PHASES, OFFER_REACHES, OFFER_SPEC_V1_KEYS, OFFER_TITLE_SCHEMA_PATTERN, OFFER_TOKEN_PATTERN, OFFER_TOOL_PATTERN, OFFERS_PER_MOD_MAX } from './offer.js';

type Schema = Record<string, unknown>;
const ID_BASE = 'https://github.com/ascend42/a-paradigm/packages/gnomon-contracts/schemas/';

const str = (re?: RegExp | string): Schema => (re ? { type: 'string', pattern: typeof re === 'string' ? re : re.source } : { type: 'string' });
const enumOf = (values: readonly string[], additive = false): Schema =>
  additive ? { type: 'string', enum: [...values], 'x-gnomon-additive': true } : { type: 'string', enum: [...values] };
const arr = (items: Schema, extra: Schema = {}): Schema => ({ type: 'array', items, ...extra });
const closedObj = (properties: Record<string, Schema>, required: readonly string[]): Schema => ({
  type: 'object',
  properties,
  required: [...required],
  additionalProperties: false,
});

const ISO = { type: 'string', pattern: ISO_DATE_TIME.source };
const SHA = str(SHA256_TAGGED);

export const EVENT_V1_SCHEMA: Schema = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${ID_BASE}event.v1.schema.json`,
  title: 'event:v1',
  description: 'Gnomon kernel log envelope (spec §4.1). Labels default per kind (§9.1, x-gnomon-kinds).',
  'x-gnomon-kinds': [...EVENT_KIND_NAMES],
  'x-gnomon-open-namespaces': [...OPEN_USERLAND_NAMESPACES],
  'x-gnomon-reserved-kinds': Object.fromEntries(
    EVENT_KIND_NAMES.filter((k) => EVENT_KINDS[k]!.reserved).map((k) => [k, EVENT_KINDS[k]!.reserved]),
  ),
  'x-gnomon-reserved-payload-fields': RESERVED_PAYLOAD_FIELDS,
  'x-gnomon-session-taints': [...SESSION_TAINTS],
  'x-gnomon-suspect-reasons': [...APPROVAL_SUSPECT_REASONS],
  'x-gnomon-reserved-kind-payloads': RESERVED_KIND_PAYLOADS,
  'x-gnomon-kind-payloads': KIND_PAYLOADS,
  'x-gnomon-compaction-reasons': [...COMPACTION_REASONS],
  ...closedObj(
    {
      schemaVersion: { const: 'event:v1' },
      id: str(ID_PATTERNS.ev),
      log: str(ID_PATTERNS.log),
      seq: { type: 'integer', minimum: 1 },
      at: ISO,
      principal: str(ANY_PRINCIPAL_PATTERN),
      keyId: str(KEY_ID_PATTERN),
      deviceId: str(DEVICE_ID_PATTERN),
      connId: str(ID_PATTERNS.conn),
      idem: SHA,
      session: str(HSID_PATTERN),
      scope: closedObj(
        {
          org: { type: 'null' },
          team: { type: 'null' },
          repo: str(REPO_SCOPE_PATTERN),
          loop: str('^loop:.+$'),
          contract: str(CONTRACT_ID_PATTERN),
        },
        ['org', 'team'],
      ),
      audience: enumOf(AUDIENCES),
      sensitivity: enumOf(SENSITIVITIES),
      kind: str(KIND_PATTERN),
      causes: arr(str(REF_V1_JSON_PATTERN)),
      payload: {},
      ref: str(REF_V1_JSON_PATTERN),
      refHash: SHA,
      prev: SHA,
      hash: SHA,
      sig: { type: 'string', minLength: 1 },
    },
    EVENT_V1_REQUIRED,
  ),
});

export const REF_V1_SCHEMA: Schema = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${ID_BASE}ref.v1.schema.json`,
  title: 'ref:v1',
  description: 'ref = scheme ":" id ["@" rev] (spec §4.4); canonical (alias-expanded) form.',
  'x-gnomon-schemes': [...REF_SCHEMES],
  ...str(REF_V1_JSON_PATTERN),
});

export const REFUSAL_V1_SCHEMA: Schema = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${ID_BASE}refusal.v1.schema.json`,
  title: 'refusal:v1',
  description: 'Gnomon superset of Warpline refusal:v1 (spec §4.6). Every Warpline refusal validates (G-CON-02).',
  ...closedObj(
    {
      schemaVersion: { const: 'refusal:v1' },
      code: enumOf(REFUSAL_CODES),
      verdict: { type: ['string', 'null'] },
      gate: enumOf(REFUSAL_GATES, true),
      retriable: enumOf(RETRIABILITIES),
      contested: arr(
        closedObj(
          {
            stableKey: { type: 'string' },
            symbol: { type: 'string' },
            rule: { type: ['string', 'null'] },
            conflictingSlots: arr({ type: 'string' }),
            rank: enumOf(CONTESTED_RANKS),
          },
          ['stableKey', 'symbol', 'rule', 'conflictingSlots', 'rank'],
        ),
        { maxItems: MAX_CONTESTED },
      ),
      contestedTotal: { type: 'integer', minimum: 0 },
      pointers: closedObj(
        {
          knotPayloadId: { type: 'string' },
          proposedStateId: { type: 'string' },
          rebasedOnto: { type: 'string' },
          claimId: { type: 'string' },
          symbols: arr({ type: 'string' }),
        },
        [],
      ),
      next: arr(
        closedObj(
          {
            verb: { type: 'string', minLength: 1 },
            params: { type: 'object', additionalProperties: { type: 'string' } },
            requires: arr({ type: 'string' }),
            principal: enumOf(NEXT_PRINCIPALS),
          },
          ['verb', 'params', 'requires', 'principal'],
        ),
      ),
      override: closedObj({ flag: enumOf(OVERRIDE_FLAGS), principal: { const: 'human' } }, ['flag', 'principal']),
      data: {
        type: 'object',
        properties: {
          reason: enumOf(REFUSAL_REASONS, true),
          offered: arr({ type: 'string' }),
          cardId: { type: 'string' },
        },
      },
    },
    REFUSAL_V1_REQUIRED,
  ),
});

/* ── change-note:v1 and review-finding:v1 (§4.11, reserved M1.1, P8-D86–D88) ── */

const bytesCapped = (max: number): Schema => ({ type: 'string', 'x-gnomon-max-utf8-bytes': max });
const REF_STR = str(REF_V1_JSON_PATTERN);

const AGENT_CLAIMS: Schema = {
  ...closedObj(
    {
      testedHow: closedObj({ summary: bytesCapped(CHANGE_NOTE_LIMITS.summaryBytes), refs: arr(REF_STR) }, ['summary', 'refs']),
      risk: closedObj(
        { tier: enumOf(RISK_TIERS, true), why: bytesCapped(CHANGE_NOTE_LIMITS.whyBytes), blast: arr(str('^sym:.+$')) },
        ['tier', 'why', 'blast'],
      ),
      revert: closedObj(
        { how: enumOf(AGENT_REVERT_HOWS, true), steps: bytesCapped(CHANGE_NOTE_LIMITS.stepsBytes), reversible: { type: 'boolean' } },
        ['how', 'steps', 'reversible'],
      ),
      draftedBy: str(ANY_PRINCIPAL_PATTERN),
    },
    CHANGE_NOTE_AGENT_KEYS,
  ),
  'x-gnomon-trust': 'untrusted: agent-claimed, sanitized (§4.5), never executed, never authority (B16)',
};
const KERNEL_PART: Schema = {
  ...closedObj(
    {
      verified: closedObj({ n: { type: 'integer', minimum: 0 }, of: { type: 'integer', minimum: 0 } }, ['n', 'of']),
      risk: closedObj(
        { floor: enumOf(RISK_TIERS, true), effective: enumOf(RISK_TIERS, true), reasons: arr({ type: 'string' }) },
        ['floor', 'effective', 'reasons'],
      ),
      revert: closedObj({ how: enumOf(KERNEL_REVERT_HOWS, true), ref: REF_STR }, ['how']),
    },
    CHANGE_NOTE_KERNEL_KEYS,
  ),
  'x-gnomon-trust': 'kernel-computed; never written by the agent',
};

/** Card form (cards, contract.built, brief:v1): both parts required. card:v1.note uses it inline. */
const CHANGE_NOTE_CARD: Schema = closedObj({ agentClaims: AGENT_CLAIMS, kernel: KERNEL_PART }, ['agentClaims', 'kernel']);
/** Claim form (contract.claim{note}): agentClaims only; `kernel: false` refuses the part even for a tolerant consumer. */
const CHANGE_NOTE_CLAIM: Schema = closedObj({ agentClaims: AGENT_CLAIMS, kernel: false as unknown as Schema }, ['agentClaims']);

export const CHANGE_NOTE_V1_SCHEMA: Schema = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${ID_BASE}change-note.v1.schema.json`,
  title: 'change-note:v1',
  description:
    'Change note (spec §4.11, §3.4). Two forms: $defs/claim (contract.claim{note}: agentClaims only, never a kernel part) and $defs/card (cards, contract.built, brief:v1: agentClaims + kernel). agentClaims untrusted, kernel computed. Reserved M1.1 (P8-D86–D88).',
  $defs: { claim: CHANGE_NOTE_CLAIM, card: CHANGE_NOTE_CARD },
});

const FINDING_LOCUS: Schema = closedObj(
  { path: { type: 'string', minLength: 1 }, lines: str(LINE_RANGE_PATTERN), symbol: { type: 'string', minLength: 1 } },
  ['path'],
);

export const REVIEW_FINDING_V1_SCHEMA: Schema = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${ID_BASE}review-finding.v1.schema.json`,
  title: 'review-finding:v1',
  description:
    'Reviewer finding (spec §4.11, §7.3). severity pre-existing is kernel-set; fingerprint = sha256(class ‖ (symbol ?? path) ‖ overlapping line range). Reserved M1.1 (P8-D86–D88).',
  'x-gnomon-responses': [...FINDING_RESPONSES],
  ...closedObj(
    {
      fid: { type: 'string', minLength: 1 },
      round: { type: 'integer', minimum: 1 },
      class: { type: 'string', minLength: 1 },
      severity: enumOf(FINDING_SEVERITIES, true),
      locus: FINDING_LOCUS,
      instances: arr(FINDING_LOCUS),
      claim: { type: 'string' },
      fingerprint: SHA,
    },
    REVIEW_FINDING_V1_KEYS,
  ),
});

export const CARD_V1_SCHEMA: Schema = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${ID_BASE}card.v1.schema.json`,
  title: 'card:v1',
  description: 'Broker decision card (spec §3.4). Enums additive per §4.9; unknown state = not decidable.',
  ...closedObj(
    {
      schemaVersion: { const: 'card:v1' },
      cardId: str(ID_PATTERNS.card),
      kind: enumOf(CARD_KINDS, true),
      direction: enumOf(HANDOFF_DIRECTIONS),
      requestedBy: str(ANY_PRINCIPAL_PATTERN),
      hsid: str(HSID_PATTERN),
      contractId: str(CONTRACT_ID_PATTERN),
      nodeId: { type: 'string' },
      attended: { type: 'boolean' },
      approverPolicy: { type: 'object', properties: { kind: enumOf(['self'], true) }, required: ['kind'] },
      block: { type: 'object', properties: { schemaVersion: { const: 'display-block:v1' } }, required: ['schemaVersion'] },
      contentHash: SHA,
      flags: arr(enumOf(CARD_FLAGS, true)),
      actions: { type: 'array' },
      state: enumOf(CARD_STATES, true),
      heldUntil: ISO,
      heldDecision: enumOf(CARD_DECISIONS, true),
      voice: {
        type: 'object',
        properties: {
          eligible: enumOf(VOICE_ELIGIBILITY, true),
          reason: enumOf(VOICE_INELIGIBLE_REASONS, true),
          label: { type: 'string' },
          readback: { type: 'string' },
          readbackHash: SHA,
          echo: { type: 'string' },
        },
        required: ['eligible', 'label', 'readback', 'readbackHash', 'echo'],
      },
      decidedBy: str(ANY_PRINCIPAL_PATTERN),
      decidedAt: ISO,
      decisionSig: { type: 'string' },
      presence: enumOf(PRESENCE_VALUES, true),
      via: enumOf(VIA_VALUES, true),
      voiceDecision: {
        type: 'object',
        properties: {
          armId: str(ID_PATTERNS.arm),
          armClass: enumOf(VOICE_ARM_CLASSES, true),
          humanConnId: str(ID_PATTERNS.conn),
          voiceConnId: str(ID_PATTERNS.conn),
          turnId: { type: 'string' },
          confirmTurnId: { type: 'string' },
          deckId: { type: 'string' },
          ordinal: { type: 'integer', minimum: 1 },
          label: { type: 'string' },
          handleHash: SHA,
          challengeHash: SHA,
          readbackHash: SHA,
          speakerId: { type: 'string' },
          asrConfidence: { type: 'number', minimum: 0, maximum: 1 },
          mode: enumOf(VOICE_MODES, true),
        },
        required: ['armId', 'armClass', 'humanConnId', 'voiceConnId', 'turnId', 'speakerId', 'asrConfidence', 'mode'],
      },
      note: CHANGE_NOTE_CARD,
      strictness: closedObj(
        { level: enumOf(STRICTNESS_LEVELS, true), mode: enumOf(RUN_MODES, true), reason: { type: 'string' } },
        ['level', 'mode', 'reason'],
      ),
      cli: { type: 'object' },
      timeoutAt: ISO,
    },
    CARD_V1_REQUIRED,
  ),
});

export const HELLO_V1_SCHEMA: Schema = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${ID_BASE}gnomon-rpc.v1.hello.schema.json`,
  title: 'gnomon-rpc:v1 hello',
  description: 'hello params and result (spec §4.9). Highest shared clientApi wins; none ⇒ UNSUPPORTED{data:{offered[]}}. The result echoes clientNonce and serverSig covers it (T-2026-10-18-016).',
  $defs: {
    params: closedObj(
      {
        clientApis: arr(str('^[a-z][a-z0-9-]*:v[1-9][0-9]*$'), { minItems: 1 }),
        features: arr({ type: 'string' }),
        clientNonce: str(CLIENT_NONCE_PATTERN_SOURCE),
        client: closedObj(
          {
            name: { type: 'string', minLength: 1 },
            version: { type: 'string', minLength: 1 },
            surface: enumOf(CLIENT_SURFACES, true),
            conformance: closedObj(
              { suite: { type: 'string' }, version: { type: 'string' }, reportHash: { type: 'string' } },
              ['suite', 'version', 'reportHash'],
            ),
          },
          ['name', 'version'],
        ),
      },
      ['clientApis', 'features', 'clientNonce', 'client'],
    ),
    result: closedObj(
      {
        clientApi: str('^gnomon-rpc:v[1-9][0-9]*$'),
        features: arr({ type: 'string' }),
        nonce: { type: 'string', minLength: 1 },
        clientNonce: str(CLIENT_NONCE_PATTERN_SOURCE),
        serverKeyId: { type: 'string', minLength: 1 },
        serverSig: { type: 'string', minLength: 1 },
        clientApiId: { type: 'string', minLength: 1 },
        kitId: { type: 'string', minLength: 1 },
      },
      HELLO_RESULT_KEYS,
    ),
  },
});

/* ── offer-spec:v1 (the Desk, TD-2026-10-20-812) ── */

/** Single-line display text: the validator also refuses control, format and separator characters and edge whitespace. */
const offerText = (max: number): Schema => ({ type: 'string', minLength: 1, maxLength: max, 'x-gnomon-single-line': true });
const offerTokens = (max: number): Schema => arr(str(OFFER_TOKEN_PATTERN), { maxItems: max, uniqueItems: true });

export const OFFER_SPEC_V1_SCHEMA: Schema = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${ID_BASE}offer-spec.v1.schema.json`,
  title: 'offer-spec:v1',
  description:
    'One playbook offer a mod manifest declares under provides.offers (the Desk, TD-2026-10-20-812). Structured fields only (A7). A model proposes it with one ```offer block {mod, kind, question} (offerBlockOf).',
  'x-gnomon-max-per-mod': OFFERS_PER_MOD_MAX,
  ...closedObj(
    {
      kind: str(OFFER_TOKEN_PATTERN),
      phase: enumOf(OFFER_PHASES),
      title: { ...offerText(OFFER_LIMITS.title), pattern: OFFER_TITLE_SCHEMA_PATTERN },
      summary: offerText(OFFER_LIMITS.summary),
      contextIn: arr(enumOf(CONTEXT_SOURCES), { maxItems: OFFER_LIMITS.contextIn, uniqueItems: true }),
      resultOut: str(OFFER_TOKEN_PATTERN),
      reach: enumOf(OFFER_REACHES),
      handoffTool: str(OFFER_TOOL_PATTERN),
      related: offerTokens(OFFER_LIMITS.related),
      restraint: offerText(OFFER_LIMITS.restraint),
    },
    OFFER_SPEC_V1_KEYS,
  ),
});

/* ── release-manifest:v1 (zero-build release pins, TD-2026-10-21-758) ── */

export const RELEASE_MANIFEST_V1_SCHEMA: Schema = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${ID_BASE}release-manifest.v1.schema.json`,
  title: 'release-manifest:v1',
  description:
    'The native executables one Gnomon release ships (GnomonHelper.app, GnomonVoiceIO.app) and the exact sha256 the kernel accepts for each (G-HLP-01). Written by packages/gnomon/scripts/write-release-manifest.mjs and embedded in the build stamp; at most one entry per (name, arch), a universal entry stands alone (validateReleaseManifestV1).',
  ...closedObj(
    {
      schemaVersion: { const: RELEASE_MANIFEST_V1 },
      release: str(RELEASE_VERSION_PATTERN),
      artifacts: arr(
        closedObj(
          {
            name: enumOf(RELEASE_ARTIFACT_NAMES),
            version: str(ARTIFACT_VERSION_PATTERN),
            sha256: str(SHA256_HEX_PATTERN),
            requirement: { type: 'string', minLength: 1, maxLength: RELEASE_REQUIREMENT_MAX },
            arch: enumOf(RELEASE_ARCHES),
          },
          RELEASE_ARTIFACT_V1_KEYS,
        ),
        { minItems: 1, maxItems: RELEASE_ARTIFACTS_MAX },
      ),
      appZips: arr(closedObj({ arch: enumOf(APP_ZIP_ARCHES), sha256: str(SHA256_HEX_PATTERN) }, RELEASE_APP_ZIP_V1_KEYS), { minItems: 1, maxItems: APP_ZIP_ARCHES.length }),
    },
    RELEASE_MANIFEST_V1_KEYS,
  ),
});

/** File name → schema, for the generator and the fixed-point test. */
export const CONTRACT_SCHEMAS: Readonly<Record<string, Schema>> = Object.freeze({
  'event.v1.schema.json': EVENT_V1_SCHEMA,
  'ref.v1.schema.json': REF_V1_SCHEMA,
  'refusal.v1.schema.json': REFUSAL_V1_SCHEMA,
  'card.v1.schema.json': CARD_V1_SCHEMA,
  'gnomon-rpc.v1.hello.schema.json': HELLO_V1_SCHEMA,
  'review-finding.v1.schema.json': REVIEW_FINDING_V1_SCHEMA,
  'change-note.v1.schema.json': CHANGE_NOTE_V1_SCHEMA,
  'offer-spec.v1.schema.json': OFFER_SPEC_V1_SCHEMA,
});

/**
 * Schemas generated the same way but OUTSIDE the client API (they do not feed CLIENT_API_DESCRIPTOR, so adding one
 * does not move clientApiId): build/release artifacts no client speaks.
 */
export const BUILD_SCHEMAS: Readonly<Record<string, Schema>> = Object.freeze({
  'release-manifest.v1.schema.json': RELEASE_MANIFEST_V1_SCHEMA,
});

/** How a schema file is serialized on disk (2-space JSON + newline). */
export function serializeSchema(schema: Schema): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}
