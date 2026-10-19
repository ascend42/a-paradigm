/**
 * Client API identity (spec §12.3, §12.8): `kitId` and `clientApiId`.
 *
 * HOW THE IDS ARE COMPUTED (stable, documented, tested):
 *
 *   kitId       = "sha256:" + hex(sha256(canonicalJson(KIT_V1_DESCRIPTOR)))
 *   clientApiId = "sha256:" + hex(sha256(canonicalJson(CLIENT_API_DESCRIPTOR) + "\n" + kitId))
 *
 * `canonicalJson` = sorted keys, no whitespace (internal.ts). The "‖ kitId" of
 * §12.3/§12.8 is read as concatenation INSIDE the hash (a single digest, so a
 * kit change moves clientApiId), separated by "\n" so the boundary is
 * unambiguous. CLIENT_API_DESCRIPTOR is the frozen client surface: the 12
 * verbs + 2 relays (full descriptors), the JSON-RPC code map, the additive enum
 * table, every client JSON Schema this package publishes (which embed the
 * event-kind registry, ref schemes, refusal/card enums, the hello shape and
 * review-finding:v1 / change-note:v1), the M1.1 reservations that have no
 * schema yet (verb param values, content parts, status fields), and (P8-D93
 * round 3) the auth wire format: the three domains and one fixed preimage
 * vector per auth form (AUTH_WIRE_DESCRIPTOR). P8-D98 adds the three human-device
 * verbs, the reserved hello features, the log.read cursor, the closed P8-D98
 * values and the decisionSig v2 vector (DECISION_SIG_DESCRIPTOR).
 * A change to any of them moves clientApiId; `modAbiId` is NOT an input
 * (a mod-ABI change never churns clients, A24-2).
 *
 * PR-3 scope note: kit:v1 is represented by its frozen block list only; the
 * full kit schema (Image/Canvas fields) arrives with display-block:v1 in M1.1,
 * which will move kitId and therefore clientApiId once, before the 8.0 freeze.
 */

import { canonicalJson, deepFreeze, hex, sha256 } from './internal.js';
import {
  VERBS,
  CLIENT_RELAYS,
  ADDITIVE_ENUMS,
  GNOMON_RPC_V1,
  FAIL_SAFE_VALUES,
  VERB_PARAM_VALUES,
  RESERVED_CONTENT_PARTS,
  STATUS_RESERVED_FIELDS,
  AUTH_SERVER_DOMAIN,
  AUTH_CLIENT_DOMAIN,
  AUTH_TOKEN_DOMAIN,
  authServerPreimage,
  authClientPreimage,
  authTokenPreimage,
  HUMAN_DEVICE_VERBS,
  RESERVED_HELLO_FEATURES,
  LOG_READ_CURSOR_KEYS,
  D98_CLOSED_VALUES,
  VOICE_CLOSED_VALUES,
} from './rpc.js';
import { APPROVE_SIG_DOMAIN, DECISION_SIG_V2_DECISIONS, DECISION_SIG_V2_MARKER, decisionMessageV2 } from './card.js';
import { JSON_RPC_CODES } from './refusal.js';
import { CONTRACT_SCHEMAS } from './schemas.js';

export const KIT_V1 = 'kit:v1' as const;
export const KIT_V1_BLOCKS = Object.freeze([
  'Box',
  'Text',
  'List',
  'Table',
  'Markdown',
  'Diff',
  'Progress',
  'Button',
  'Image',
  'Canvas',
] as const);

export const KIT_V1_DESCRIPTOR = deepFreeze({ schemaVersion: KIT_V1, blocks: [...KIT_V1_BLOCKS] });

/**
 * The auth wire format (§4.9; Aegis ruling, T-2026-10-18-016 round 3, P8-D93):
 * the three signature domains plus ONE fixed preimage vector per form — fixed
 * inputs and the exact preimage string the helpers produce. A changed domain
 * or a changed message layout changes these strings, so it moves clientApiId.
 */
const VECTOR_NEGOTIATED = { clientApi: GNOMON_RPC_V1, features: ['b', 'a'] } as const;
export const AUTH_WIRE_DESCRIPTOR = deepFreeze({
  domains: { server: AUTH_SERVER_DOMAIN, client: AUTH_CLIENT_DOMAIN, token: AUTH_TOKEN_DOMAIN },
  vectors: {
    server: {
      inputs: { nonce: 'N', clientNonce: 'CN', endpointPath: '/s', negotiated: VECTOR_NEGOTIATED },
      preimage: authServerPreimage('N', 'CN', '/s', VECTOR_NEGOTIATED),
    },
    client: {
      inputs: { nonce: 'N', serverKeyId: 'k', principalId: 'p', deviceId: 'd', endpointPath: '/s', negotiated: VECTOR_NEGOTIATED },
      preimage: authClientPreimage('N', 'k', 'p', 'd', '/s', VECTOR_NEGOTIATED),
    },
    token: {
      inputs: { nonce: 'N', serverKeyId: 'k', tokenId: 'rtk:X', endpointPath: '/s', negotiated: VECTOR_NEGOTIATED },
      preimage: authTokenPreimage('N', 'k', 'rtk:X', '/s', VECTOR_NEGOTIATED),
    },
  },
});

/**
 * decisionSig v2 (P8-D98): the version marker, the decisions that use it and ONE fixed message vector, so a changed
 * layout moves clientApiId. The kernel signer (slice A2) must produce exactly this message for these inputs.
 */
const DECISION_V2_INPUTS = {
  cardId: 'card:01J00000000000000000000000',
  decision: 'answer',
  cardContentHash: `sha256:${'c'.repeat(64)}`,
  approverPrincipalId: 'p:local/founder',
  answerDigest: `sha256:${'a'.repeat(64)}`,
} as const;
export const DECISION_SIG_DESCRIPTOR = deepFreeze({
  domain: APPROVE_SIG_DOMAIN,
  v2: {
    marker: DECISION_SIG_V2_MARKER,
    decisions: [...DECISION_SIG_V2_DECISIONS],
    vector: { inputs: DECISION_V2_INPUTS, message: decisionMessageV2(DECISION_V2_INPUTS) },
  },
});

export const CLIENT_API_DESCRIPTOR = deepFreeze({
  clientApi: GNOMON_RPC_V1,
  verbs: VERBS,
  relays: CLIENT_RELAYS,
  jsonRpcCodes: JSON_RPC_CODES,
  additiveEnums: ADDITIVE_ENUMS,
  schemas: CONTRACT_SCHEMAS,
  // M1.1 reservations that live outside a JSON Schema (§4.11, §19.1 M1.1).
  verbParamValues: VERB_PARAM_VALUES,
  contentParts: RESERVED_CONTENT_PARTS,
  statusFields: STATUS_RESERVED_FIELDS,
  failSafe: FAIL_SAFE_VALUES,
  // P8-D93 round 3 (Aegis): domains + one preimage vector per auth form
  auth: AUTH_WIRE_DESCRIPTOR,
  // P8-D98 (T-2026-10-19-001): the human-device verbs, the reserved hello features, the log.read cursor shape,
  // the closed always-rule match and drain reason, and the decisionSig v2 layout.
  humanDeviceVerbs: HUMAN_DEVICE_VERBS,
  helloFeatures: { reserved: RESERVED_HELLO_FEATURES },
  logReadCursor: LOG_READ_CURSOR_KEYS,
  closedValues: D98_CLOSED_VALUES,
  decisionSig: DECISION_SIG_DESCRIPTOR,
  // TD-2026-10-19-194 (voice V0): closed disarm reasons + voice-strictness ceilings; status.arms/armCustody ride statusFields.
  voiceClosedValues: VOICE_CLOSED_VALUES,
});

export function computeKitId(kit: unknown = KIT_V1_DESCRIPTOR): string {
  return `sha256:${hex(sha256(canonicalJson(kit)))}`;
}

export function computeClientApiId(descriptor: unknown = CLIENT_API_DESCRIPTOR, kitId: string = computeKitId()): string {
  return `sha256:${hex(sha256(`${canonicalJson(descriptor)}\n${kitId}`))}`;
}

/** Frozen per release; reported by `status` and in the hello result. */
export const KIT_ID: string = computeKitId();
export const CLIENT_API_ID: string = computeClientApiId();
