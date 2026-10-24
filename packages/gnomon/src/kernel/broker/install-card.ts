/**
 * @symbol #approval-broker
 * @symbol #manifest-loader
 *
 * TD-2026-10-20-514: ONE presence per install. The card's detail carries rootRows (the rows the decision will
 * sign, Aegis C1a, inside contentHash); `prepare` takes the home's one in-flight root decision (C5d), runs every
 * install check and BUILDS the rows (prepareInstall, which refuses when they are not the rows shown, C1b); the
 * broker signs the decision row and every row in one decision.sign; the effect commits them (commitInstall: the
 * token consumed there, one write, grant.install last). No synchronous `once` signature on this path.
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
import { commitInstall, decideInstall, installPresenceBinding, installRootRows, prepareInstall, rederiveInstallDetail, type PreparedInstall } from '../manifest/install.js';
import { beginRootDecision } from '../manifest/grant-lock.js';
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
  const servers = (): readonly string[] | undefined => o.userMcpServers?.();
  // Aegis C1a: what the decision will sign, shown on the card; a card whose rows cannot be built now carries none
  // (the GUI shows no Approve on it, and its decide refuses with the real reason from prepareInstall)
  let rootRows: Record<string, unknown>[] | undefined;
  try {
    const sv = servers();
    rootRows = installRootRows(o.home, o.name, o.cardId, { authority: o.authority, ...(sv ? { userMcpServers: sv } : {}) });
  } catch {
    rootRows = undefined;
  }
  return broker.raise({
    kind: 'install',
    cardId: o.cardId,
    requestedBy: record.card.requestedBy,
    ...(record.card.hsid ? { hsid: record.card.hsid } : {}),
    attended: record.card.attended,
    detail: { ...(detail as unknown as Record<string, unknown>), ...(rootRows ? { rootRows } : {}) },
    // rendered by the broker's sanitizer (flags enter contentHash, Aegis C4); presence binds the detail hash + decision
    lines,
    // the lines arrive pre-sanitized and wrapped (never cut); their sanitizer flags travel explicitly
    flags,
    presence: { purpose: 'mod.install', binding: (decision) => installPresenceBinding(o.cardId, detailHash, decision === 'install' ? 'install' : 'deny'), consumedByEffect: true },
    prepare: (decision) => {
      if (decision !== 'install') return null; // deny is fresh class: no row
      const release = beginRootDecision(o.home); // C5d: refused at once while another root decision of this home is in flight
      try {
        const sv = servers();
        const state = prepareInstall(o.home, o.name, o.cardId, 'install', { authority: o.authority, ...(sv ? { userMcpServers: sv } : {}), ...(rootRows ? { expectedRootRows: rootRows } : {}) });
        if (!rootRows) throw fail('BAD_REQUEST', 'bad-params', `install card ${o.cardId} shows no rows; raise it again`, { cardId: o.cardId });
        return { rows: state.rows as unknown as Record<string, unknown>[], release, state };
      } catch (e) {
        release();
        throw e;
      }
    },
    effect: async (decision, ctx) => {
      if (decision === 'install') {
        const p = ctx.prepared?.state as PreparedInstall | undefined;
        if (!p || !ctx.rowSigs) throw fail('BAD_REQUEST', 'bad-params', 'an install commits only prepared, signed rows', { cardId: o.cardId });
        commitInstall(p, ctx.rowSigs, ctx.token, { authority: o.authority, ...(o.emit ? { emit: o.emit } : {}) });
        return;
      }
      const sv = servers();
      decideInstall(o.home, o.name, o.cardId, 'deny', { presenceToken: ctx.token, authority: o.authority, ...(o.emit ? { emit: o.emit } : {}), ...(sv ? { userMcpServers: sv } : {}) });
    },
  });
}
