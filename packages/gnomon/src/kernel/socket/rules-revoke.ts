/**
 * @symbol #rules-revoke
 *
 * #rules-revoke (P8-D98 human-device verb 14, TD-2026-10-19-528 F1): the
 * `rules.revoke{ruleId}` handler, wired into the dispatcher's
 * `humanVerbs['rules.revoke']` port by the daemon. The dispatcher calls it
 * only for a human principal on a verified device connection; every other
 * class is refused by the registry tier before it gets here.
 *
 * No presence prompt (F1): revoking only narrows what runs without a card.
 *
 *   - params: exactly `{ruleId}`, a card id (RULE_ID_PATTERN) ⇒ else BAD_REQUEST;
 *   - the rule must stand in the kernel's RuleBook, folded from KERNEL-signed
 *     rows only (supervisor/rules.ts) ⇒ else NOT_FOUND (unknown, forged, or
 *     already revoked);
 *   - the kernel appends `approval.rule.revoked{ruleId, repoKey, tool, connId}`
 *     (kernel-signed; connId is THIS connection, never a param), then folds
 *     the chain again so the next permission check sees the rule gone;
 *   - revokes run one at a time, so two concurrent revokes of one rule write
 *     one row (the second is NOT_FOUND).
 * The result is `{ruleId, revoked: true}`.
 */
import { RULE_ID_PATTERN, type ApprovalRuleRevokedPayload, type RulesRevokeResult } from '@a-company/gnomon-contracts';
import type { AlwaysRule } from '../supervisor/rules.js';
import type { HumanDeviceVerbHandler } from './dispatch.js';
import { RpcRefusal } from './rpc.js';

export interface RulesRevokeDeps {
  /** Catch the kernel's RuleBook up with the chain, then look a rule up (null ⇒ none stands). */
  lookup: (ruleId: string) => AlwaysRule | null;
  /** Append the kernel-signed approval.rule.revoked row; must reject if the row was not written. */
  append: (payload: ApprovalRuleRevokedPayload, ids: { connId: string }) => Promise<unknown>;
}

export function createRulesRevokeHandler(d: RulesRevokeDeps): HumanDeviceVerbHandler {
  let queue: Promise<unknown> = Promise.resolve();
  return (ctx, params) => {
    const run = queue.then(() => revokeOne(d, ctx.connId, params));
    queue = run.catch(() => undefined);
    return run;
  };
}

async function revokeOne(d: RulesRevokeDeps, connId: string, params: unknown): Promise<RulesRevokeResult> {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) throw new RpcRefusal('BAD_REQUEST', 'params', 'rules.revoke takes {ruleId}');
  const extra = Object.keys(params).filter((k) => k !== 'ruleId');
  if (extra.length > 0) throw new RpcRefusal('BAD_REQUEST', 'params', `rules.revoke takes only {ruleId} (unknown: ${extra.slice(0, 4).join(', ')})`);
  const ruleId = (params as { ruleId?: unknown }).ruleId;
  if (typeof ruleId !== 'string' || !RULE_ID_PATTERN.test(ruleId)) throw new RpcRefusal('BAD_REQUEST', 'params', 'ruleId must be the card id the rule was learned on (card:<ULID>)');
  const rule = d.lookup(ruleId);
  if (!rule) throw new RpcRefusal('NOT_FOUND', 'no-such-rule', `no standing always-allow rule ${ruleId} (unknown, or already revoked)`, { ruleId });
  await d.append({ ruleId, repoKey: rule.repoKey, tool: rule.tool, connId }, { connId });
  d.lookup(ruleId); // fold the new row now: the next permission check raises the card again
  return { ruleId, revoked: true };
}
