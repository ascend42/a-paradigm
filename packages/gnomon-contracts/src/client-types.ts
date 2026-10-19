/**
 * Typed params and results of the client-callable surface (spec §5: 12 kernel
 * verbs + 2 client relays, §12.8). TYPES ONLY — no runtime value, so nothing
 * here is an input to clientApiId; the frozen surface is VERBS / CLIENT_RELAYS
 * in rpc.ts, and `ClientMethodParams` is checked against CLIENT_METHODS by the
 * TS client's tests. Results the spec leaves open (status, log.read pages)
 * are typed by their stable fields plus an index signature: the
 * compatible-additive rule (§4.9) lets the kernel add fields at any time.
 */

import type { CardV1 } from './card.js';
import type { ChangeNoteV1 } from './change-note.js';
import type { EventV1 } from './event.js';

type Open = Record<string, unknown>;

export interface StatusResult extends Open {
  principal?: string;
  principalKind?: string;
  connId: string;
  clientApi?: string;
  clientApiId: string;
  kitId: string;
  abiId: string;
  nextLegalVerbs: Array<{ verb: string; available: boolean }>;
  verbs: Array<{ verb: string; access: unknown; available: boolean; milestone?: string }>;
  relays: Array<{ relay: string; access: unknown; available: boolean; milestone?: string }>;
  clients: Array<{ connId: string; principal?: string; surface: string | null; conformance: unknown }>;
}

export interface SessionOpenParams {
  backend?: 'claude-code' | 'local';
  model: 'local' | 'claude' | 'any' | string;
  cwd: string;
  mode?: string;
  runMode?: string;
  as?: string;
  goal?: string;
  contract?: string;
  alias?: string;
  derived?: boolean;
  permitId?: string;
  systemPrompt?: string;
  attended: boolean;
  brief?: unknown;
}
export interface SessionOpenResult extends Open {
  hsid: string;
  principalId: string;
  backend: string;
  state: string;
}

export interface SessionSendParams {
  hsid: string;
  content: unknown[];
  permitId: string;
  steer?: boolean;
  source?: 'voice';
}
export interface SessionSendResult extends Open {
  turn: string;
}

export interface SessionStopParams {
  hsid: string;
  interrupt?: boolean;
}
export interface SessionStopResult extends Open {
  signals: string[];
  exited: boolean;
}

export interface LogAppendParams {
  kind: string;
  payload?: unknown;
  ref?: string;
  causes?: string[];
  scope?: Open;
  idem?: string;
  audience?: string;
  sensitivity?: string;
}
export interface LogAppendResult extends Open {
  id: string;
  seq: number;
  hash: string;
}

export interface LogReadParams {
  /** A bare seq today; the `{logId, seq}` cursor (LogReadCursor, P8-D98, §5) replaces it when `journal.cursor` is built. */
  since?: number;
  until?: number;
  kinds?: string[];
  scope?: Open;
  limit?: number;
  follow?: boolean;
}

/** One row of a log.read page or subscription: a (possibly projected) event, or a stub. */
export type LogRow =
  | { seq: number; view: 'full'; event: Partial<EventV1> & Pick<EventV1, 'kind' | 'principal' | 'at'> & Open }
  | { seq: number; view: 'stub'; stub: Open & { kind: string } }
  | { seq: number; view: 'oversize'; kind: string; bytes: number };

export interface LogReadPage extends Open {
  rows: LogRow[];
  next: number;
  head: number;
  caughtUp: boolean;
}
export interface LogSubscribeResult extends Open {
  subscription: string;
  since: number;
  head: number;
}

export interface PermitReserveParams {
  kind: string;
  scope: Open;
  backend?: 'claude-code' | 'local';
  model?: string;
  limits?: Open;
  tool?: string;
  input?: unknown;
}
export interface PermitReleaseParams {
  op: 'release';
  permitId: string;
}

export interface ApproveParams {
  cardId: string;
  decision: string;
  note?: string;
  decisionSig: string;
}

export interface ContractRegisterParams {
  contract: Open;
}
export interface ContractRegisterResult extends Open {
  contractId: string;
  nodes: unknown[];
}

export interface ContractClaimParams {
  contractId: string;
  nodeId: string;
  op: 'claim' | 'built' | 'release';
  ttl?: number;
  expect?: { status: string; seq: number };
  note?: ChangeNoteV1 | Open;
  responses?: Array<{ fid: string; response: string; note?: string }>;
}
export interface ContractClaimResult extends Open {
  nodeId: string;
  status: string;
  by: string;
  seq: number;
  expiresAt?: string;
}

export interface OracleRunParams {
  contractId: string;
  nodeId: string;
  oracle: string;
}

export interface RefResolveParams {
  ref: string;
}
export interface RefResolveResult extends Open {
  target: unknown;
  hash?: string;
}

/** P8-D98 human-device verb 13 (§2.4 rule 8). */
export interface GuiOpenParams {
  /** ≤ 1024 UTF-8 bytes; returned for the CLI to append as the URL fragment; never read by the kernel. */
  cwdHint?: string;
}
export interface GuiOpenResult extends Open {
  url: string;
  expiresAt: string;
}
/** P8-D98 human-device verb 14 (TD-2026-10-19-528 F1): no presence prompt; revoking only narrows. */
export interface RulesRevokeParams {
  /** The cardId whose `always` decision learned the rule. */
  ruleId: string;
}
export interface RulesRevokeResult extends Open {
  ruleId: string;
  revoked: boolean;
}

export interface ModViewParams {
  name: string;
  viewId: string;
  input?: unknown;
}
export interface ModCommandParams {
  name: string;
  commandId: string;
  args?: unknown;
}

/** method → params, for the whole client-callable surface (12 verbs + 2 human-device verbs + 2 relays). */
export interface ClientMethodParams {
  status: Record<string, never>;
  'session.open': SessionOpenParams;
  'session.send': SessionSendParams;
  'session.stop': SessionStopParams;
  'log.append': LogAppendParams;
  'log.read': LogReadParams;
  'permit.reserve': PermitReserveParams | PermitReleaseParams;
  approve: ApproveParams;
  'contract.register': ContractRegisterParams;
  'contract.claim': ContractClaimParams;
  'oracle.run': OracleRunParams;
  'ref.resolve': RefResolveParams;
  'gui.open': GuiOpenParams;
  'rules.revoke': RulesRevokeParams;
  'mod.view': ModViewParams;
  'mod.command': ModCommandParams;
}

/** method → result. */
export interface ClientMethodResults {
  status: StatusResult;
  'session.open': SessionOpenResult;
  'session.send': SessionSendResult;
  'session.stop': SessionStopResult;
  'log.append': LogAppendResult;
  'log.read': LogReadPage | LogSubscribeResult;
  'permit.reserve': Open;
  approve: CardV1;
  'contract.register': ContractRegisterResult;
  'contract.claim': ContractClaimResult;
  'oracle.run': Open;
  'ref.resolve': RefResolveResult;
  'gui.open': GuiOpenResult;
  'rules.revoke': RulesRevokeResult;
  'mod.view': Open;
  'mod.command': Open;
}

export type ClientMethod = keyof ClientMethodParams;
