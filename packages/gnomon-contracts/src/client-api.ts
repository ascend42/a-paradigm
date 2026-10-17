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
 * review-finding:v1 / change-note:v1), and the M1.1 reservations that have no
 * schema yet (verb param values, content parts, status fields).
 * A change to any of them moves clientApiId; `modAbiId` is NOT an input
 * (a mod-ABI change never churns clients, A24-2).
 *
 * PR-3 scope note: kit:v1 is represented by its frozen block list only; the
 * full kit schema (Image/Canvas fields) arrives with display-block:v1 in M1.1,
 * which will move kitId and therefore clientApiId once, before the 8.0 freeze.
 */

import { canonicalJson, deepFreeze, hex, sha256 } from './internal.js';
import { VERBS, CLIENT_RELAYS, ADDITIVE_ENUMS, GNOMON_RPC_V1, FAIL_SAFE_VALUES, VERB_PARAM_VALUES, RESERVED_CONTENT_PARTS, STATUS_RESERVED_FIELDS } from './rpc.js';
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
