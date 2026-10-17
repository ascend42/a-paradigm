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
import { AUDIENCES, SENSITIVITIES, KIND_PATTERN, EVENT_KIND_NAMES, EVENT_V1_REQUIRED, OPEN_USERLAND_NAMESPACES } from './event.js';
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
} from './card.js';
import { CLIENT_SURFACES, HELLO_RESULT_KEYS } from './rpc.js';

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
  description: 'hello params and result (spec §4.9). Highest shared clientApi wins; none ⇒ UNSUPPORTED{data:{offered[]}}.',
  $defs: {
    params: closedObj(
      {
        clientApis: arr(str('^[a-z][a-z0-9-]*:v[1-9][0-9]*$'), { minItems: 1 }),
        features: arr({ type: 'string' }),
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
      ['clientApis', 'features', 'client'],
    ),
    result: closedObj(
      {
        clientApi: str('^gnomon-rpc:v[1-9][0-9]*$'),
        features: arr({ type: 'string' }),
        nonce: { type: 'string', minLength: 1 },
        serverKeyId: { type: 'string', minLength: 1 },
        serverSig: { type: 'string', minLength: 1 },
        clientApiId: { type: 'string', minLength: 1 },
        kitId: { type: 'string', minLength: 1 },
      },
      HELLO_RESULT_KEYS,
    ),
  },
});

/** File name → schema, for the generator and the fixed-point test. */
export const CONTRACT_SCHEMAS: Readonly<Record<string, Schema>> = Object.freeze({
  'event.v1.schema.json': EVENT_V1_SCHEMA,
  'ref.v1.schema.json': REF_V1_SCHEMA,
  'refusal.v1.schema.json': REFUSAL_V1_SCHEMA,
  'card.v1.schema.json': CARD_V1_SCHEMA,
  'gnomon-rpc.v1.hello.schema.json': HELLO_V1_SCHEMA,
});

/** How a schema file is serialized on disk (2-space JSON + newline). */
export function serializeSchema(schema: Schema): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}
