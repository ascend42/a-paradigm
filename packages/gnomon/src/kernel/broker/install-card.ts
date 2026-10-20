/**
 * @symbol #approval-broker
 * @symbol #manifest-loader
 *
 * #approval-broker owns the #manifest-loader install-card decision (M1.6;
 * T-2026-10-18-008). The broker RE-DERIVES the card from the pinned snapshot
 * (manifest/install.ts rederiveInstallDetail) and renders it from that
 * detail, never from the writable staged file, and keeps the card record in
 * kernel memory. `install` is a root-class decision (fresh presence + root
 * key); presence is a `mod.install` token BOUND to {cardId, contentHash},
 * handed unburned to decideInstall, which burns it and appends the
 * root-signed grant rows (grant.install LAST). Production cannot decide
 * before M1.3 (presence and the root key both refuse).
 */
import type { CardV1 } from '@a-company/gnomon-contracts';
import type { RootAuthority } from '../identity/root-authority.js';
import { decideInstall, installPresenceBinding, rederiveInstallDetail } from '../manifest/install.js';
import type { ManifestEventSink } from '../manifest/refusal.js';
import { fail, type ApprovalBroker } from './broker.js';

export interface InstallCardOptions {
  home: string;
  name: string;
  /** the staged card's id (the broker card mirrors it) */
  cardId: string;
  authority: RootAuthority;
  emit?: ManifestEventSink;
  /** the user's MCP server names, read when the human decides (Aegis S0b M1: COLLISION re-checked at decide) */
  userMcpServers?: () => readonly string[];
}

export async function raiseInstallCard(broker: ApprovalBroker, o: InstallCardOptions): Promise<CardV1> {
  const { record, detail, lines, flags, detailHash } = rederiveInstallDetail(o.home, o.name, o.cardId);
  if (record.card.state !== 'pending') throw fail('BAD_REQUEST', 'bad-params', `install card ${o.cardId} is already decided`, { cardId: o.cardId });
  return broker.raise({
    kind: 'install',
    cardId: o.cardId,
    requestedBy: record.card.requestedBy,
    ...(record.card.hsid ? { hsid: record.card.hsid } : {}),
    attended: record.card.attended,
    detail: detail as unknown as Record<string, unknown>,
    // rendered by the broker's sanitizer (flags enter contentHash, Aegis C4); presence binds the detail hash + decision
    lines,
    // the lines arrive pre-sanitized and wrapped (never cut); their sanitizer flags travel explicitly
    flags,
    presence: { purpose: 'mod.install', binding: (decision) => installPresenceBinding(o.cardId, detailHash, decision === 'install' ? 'install' : 'deny'), consumedByEffect: true },
    effect: (decision, ctx) => {
      decideInstall(o.home, o.name, o.cardId, decision === 'install' ? 'install' : 'deny', { presenceToken: ctx.token, authority: o.authority, ...(o.emit ? { emit: o.emit } : {}), ...(o.userMcpServers ? { userMcpServers: o.userMcpServers() } : {}) });
    },
  });
}
