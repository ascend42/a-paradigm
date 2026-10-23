/**
 * @symbol #rules-apply
 *
 * #rules-apply (8.0:rules-view; session 2026-10-23-gnomon-rules-view; Aegis M2/L1/L2): the Rules view's ONE save.
 * `log.append{kind:'request.rules.apply', payload:{changes:[{ruleId, op, until?}]}}` from the human on a gui or device
 * connection (the dispatcher stamps the asker; every other class is never routed here). Dispatcher-only, never a row
 * of its own: the rows it writes are the existing approval.rule.revoked and the 8.0:rules-view
 * approval.rule.disabled / approval.rule.enabled.
 *
 *   - VALIDATE EVERYTHING FIRST ("atomic", Aegis M2): 1..RULES_APPLY_MAX changes, one per rule, each a closed
 *     {ruleId, op, until?}; every rule must stand in the kernel's RuleBook (NOT_FOUND otherwise); `off` takes `until`
 *     = an ISO time in the future and at most RULE_OFF_MAX_MS ahead of the KERNEL clock, or 'manual' (until turned back
 *     on); an `off` of a rule already off may only keep or lengthen its time (never shorten: that would loosen); `on`
 *     needs a rule that is off. The batch card's lines are composed and measured here too: over MAX_CARD_CHARS the batch
 *     is refused (never cut). Any refusal writes nothing.
 *   - NARROWING NEVER WAITS (Aegis M2): every `remove` (approval.rule.revoked) and `off` (approval.rule.disabled) is
 *     written at once, under the rules lock (the queue rules.revoke shares), no presence. A partial write of these
 *     narrowing rows (a log failure mid-batch) is acceptable: it is reported, and each row written stands.
 *   - LOOSENING TAKES ONE CARD: every `on` of the batch rides ONE `strictness` card (detail.op 'rules.apply',
 *     detail.changes inside its contentHash), allow | deny, fresh presence (never standing: standingTupleOf names no
 *     tuple for it; never voice: handOnly). Its lines name each rule in the kernel's plain words (ruleWords), never
 *     page text. On allow the effect RE-VALIDATES every `on` against the RuleBook under the rules lock: a rule revoked,
 *     or already on, while the card waited is skipped (approval.rule.enabled only clears a flag on a standing rule; it
 *     never brings a revoked rule back). Expiry or deny: the rules stay off.
 *   - THE CLOCK RUNS OUT (Aegis L2): `expireDue()` (the daemon's sweep) writes approval.rule.enabled{cause:'expired',
 *     until} for each off whose time passed, so the expiry shows in the GUI feed; the match already reads the rule on
 *     from that moment (rules.ts), whether or not the row is written yet.
 */
import { RULE_CHANGE_OPS, RULE_ID_PATTERN, RULE_OFF_MAX_MS, RULES_APPLY_MAX, ulid, type CardV1, type RuleChangeOp } from '@a-company/gnomon-contracts';
import { fail, type ApprovalBroker } from '../broker/broker.js';
import type { ModeAsker } from '../broker/run-mode.js';
import { MAX_CARD_CHARS } from '../supervisor/permission.js';
import { ruleWords, type AlwaysRule, type RuleBook } from '../supervisor/rules.js';

/** The request kind the dispatcher routes here (dispatcher-only: no row of this kind is ever written). */
export const RULES_APPLY_REQUEST = 'request.rules.apply' as const;
/** A batch card nobody decides expires into deny after this long; the rules stay off. */
export const RULES_APPLY_TIMEOUT_MS = 2 * 60_000;
/** The card op (contracts CLIENT_API_DESCRIPTOR.rulesView.cardOp). */
export const RULES_APPLY_OP = 'rules.apply' as const;

/** One promise queue: rules.revoke and request.rules.apply (and the expiry sweep) take it, so their writes never interleave. */
export type RulesLock = <T>(fn: () => Promise<T>) => Promise<T>;
export function createRulesLock(): RulesLock {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => undefined);
    return run;
  };
}

export interface RulesApplyDeps {
  /** the kernel's RuleBook, caught up with the chain (its clock is the kernel clock) */
  book: () => RuleBook;
  /** append one kernel-signed row; must reject when the row was not written */
  append: (kind: 'approval.rule.revoked' | 'approval.rule.disabled' | 'approval.rule.enabled', payload: Record<string, unknown>, ids: { connId?: string }) => Promise<unknown>;
  broker: Pick<ApprovalBroker, 'raise' | 'card'>;
  lock: RulesLock;
  /** a short, human name for a repo key (the folder of a live session), else null */
  repoName?: (repoKey: string) => string | null;
  /** the card size cap (tests lower it); default MAX_CARD_CHARS */
  maxCardChars?: number;
  timeoutMs?: number;
  /** any applied change (the mode chip re-reads repoEditsRule) */
  onChange?: () => void;
}

export interface ParsedChange {
  ruleId: string;
  op: RuleChangeOp;
  /** off: epoch ms, or null = until turned back on */
  until?: number | null;
}

export interface RulesApplyResult {
  batch: string;
  /** the narrowing rows written at once, in order */
  applied: Array<{ ruleId: string; op: 'remove' | 'off'; until?: string | null }>;
  /** the ONE card carrying every `on` (decide it allow: Touch ID once), or null when the batch only narrowed */
  cardId: string | null;
  on: string[];
}

const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const SHORT = (s: string): string => (s.length > 16 ? `…${s.slice(-10)}` : s);
const PRESET_HINT = "use the Rules view's Turn off ▾ (for 1 hour · until tomorrow · until I turn it back on)";

/** Parse and check the payload's shape (no RuleBook yet). Throws BAD_REQUEST. */
export function parseRulesApply(payload: unknown, now: number): ParsedChange[] {
  const p = obj(payload);
  if (!p) throw fail('BAD_REQUEST', 'bad-params', 'request.rules.apply takes payload {changes:[{ruleId, op, until?}]}', { hint: 'send {changes:[…]}' });
  const extra = Object.keys(p).filter((k) => k !== 'changes');
  if (extra.length) throw fail('BAD_REQUEST', 'bad-params', `request.rules.apply takes only {changes} (unknown: ${extra.slice(0, 4).join(', ')})`);
  if (!Array.isArray(p.changes) || p.changes.length === 0) throw fail('BAD_REQUEST', 'bad-params', 'changes is a non-empty list', { hint: 'stage at least one change' });
  if (p.changes.length > RULES_APPLY_MAX) throw fail('BAD_REQUEST', 'too-many', `at most ${RULES_APPLY_MAX} changes in one save (got ${p.changes.length})`, { hint: `save in parts of ${RULES_APPLY_MAX} or fewer` });
  const seen = new Set<string>();
  return p.changes.map((raw, i): ParsedChange => {
    const c = obj(raw);
    if (!c) throw fail('BAD_REQUEST', 'bad-params', `changes[${i}] is {ruleId, op, until?}`);
    const bad = Object.keys(c).filter((k) => k !== 'ruleId' && k !== 'op' && k !== 'until');
    if (bad.length) throw fail('BAD_REQUEST', 'bad-params', `changes[${i}] takes only {ruleId, op, until?} (unknown: ${bad.slice(0, 4).join(', ')})`);
    if (typeof c.ruleId !== 'string' || !RULE_ID_PATTERN.test(c.ruleId)) throw fail('BAD_REQUEST', 'bad-params', `changes[${i}].ruleId must be the card id the rule was learned on (card:<ULID>)`);
    if (seen.has(c.ruleId)) throw fail('BAD_REQUEST', 'bad-params', `one change per rule (${c.ruleId} is named twice)`, { ruleId: c.ruleId });
    seen.add(c.ruleId);
    if (!(RULE_CHANGE_OPS as readonly unknown[]).includes(c.op)) throw fail('BAD_REQUEST', 'bad-params', `changes[${i}].op is one of ${RULE_CHANGE_OPS.join(', ')}`);
    const op = c.op as RuleChangeOp;
    if (op !== 'off') {
      if ('until' in c) throw fail('BAD_REQUEST', 'bad-params', `changes[${i}].until is only for op 'off'`);
      return { ruleId: c.ruleId, op };
    }
    if (c.until === 'manual') return { ruleId: c.ruleId, op, until: null };
    // Aegis L2: until is on the KERNEL clock, in the future, and at most seven days ahead
    const t = typeof c.until === 'string' ? Date.parse(c.until) : NaN;
    if (!Number.isFinite(t)) throw fail('BAD_REQUEST', 'bad-params', `changes[${i}].until is an ISO time or 'manual'`, { ruleId: c.ruleId, hint: PRESET_HINT });
    if (t <= now) throw fail('BAD_REQUEST', 'until-past', `the off time ${new Date(t).toISOString()} has already passed on the kernel clock (${new Date(now).toISOString()})`, { ruleId: c.ruleId, hint: 'choose the time again: the presets follow the kernel clock' });
    if (t - now > RULE_OFF_MAX_MS) throw fail('BAD_REQUEST', 'until-too-far', `an off time is at most 7 days ahead (asked: ${new Date(t).toISOString()})`, { ruleId: c.ruleId, hint: "choose 'until I turn it back on' for longer" });
    return { ruleId: c.ruleId, op, until: t };
  });
}

/** The card's lines for the `on` changes: the kernel's words for each rule (Aegis L1), never cut. */
export function rulesOnLines(rules: readonly AlwaysRule[], repoName?: (repoKey: string) => string | null): string[] {
  const n = rules.length;
  return [
    `Turn ${n === 1 ? 'a rule' : `${n} rules`} back on (no card next time)`,
    ...rules.map((r) => `on again: ${ruleWords(r)} · in ${repoName?.(r.repoKey) ?? `repo ${SHORT(r.repoKey)}`}`),
    `Allow needs Touch ID or your Mac password, once for ${n === 1 ? 'it' : `all ${n}`}; deny or no answer leaves ${n === 1 ? 'it' : 'them'} off`,
  ];
}

export function createRulesApply(d: RulesApplyDeps): {
  apply(asker: ModeAsker, payload: unknown): Promise<RulesApplyResult>;
  expireDue(): Promise<number>;
  /** the card id of a pending batch card, if any (status.rules.pendingCardId) */
  pendingCardId(): string | null;
} {
  let pending: string | null = null;
  const changed = (): void => {
    try {
      d.onChange?.();
    } catch {
      /* the rows are written; the next read sees them */
    }
  };

  const apply = (asker: ModeAsker, payload: unknown): Promise<RulesApplyResult> =>
    d.lock(async () => {
      if (asker.principalClass !== 'human' || (asker.credential !== 'gui' && asker.credential !== 'device') || typeof asker.principal !== 'string') {
        throw fail('FORBIDDEN', 'matrix', "rules are changed only by the human on a first-party connection (the GUI, or this home's human device)", { verb: 'log.append' });
      }
      const book = d.book();
      const now = book.now();
      const changes = parseRulesApply(payload, now);
      // validate EVERY change against the RuleBook before any write (Aegis M2)
      const ons: AlwaysRule[] = [];
      const rows: Array<{ rule: AlwaysRule; c: ParsedChange }> = [];
      for (const c of changes) {
        const rule = book.get(c.ruleId);
        if (!rule) throw fail('NOT_FOUND', 'not-found', `no standing always rule ${c.ruleId} (unknown, or removed meanwhile)`, { ruleId: c.ruleId, hint: 'the list has changed: look again, then save' });
        const st = book.stateOf(c.ruleId, now);
        if (c.op === 'on') {
          if (st.state !== 'off') throw fail('BAD_REQUEST', 'already-on', `${ruleWords(rule)} is already on`, { ruleId: c.ruleId, hint: 'drop this change, then save' });
          ons.push(rule);
        } else if (c.op === 'off' && st.state === 'off') {
          // already off: keep or lengthen only (a shorter time would turn it on sooner: a loosening)
          const cur = st.until === null ? null : Date.parse(st.until);
          const shorter = cur === null ? c.until !== null : c.until !== null && c.until! < cur;
          if (shorter) throw fail('BAD_REQUEST', 'would-loosen', `${ruleWords(rule)} is already off${st.until ? ` until ${st.until}` : ' until you turn it back on'}; a shorter time would turn it on sooner`, { ruleId: c.ruleId, hint: 'turn it on instead (that asks Touch ID once), or keep it off' });
        }
        if (c.op !== 'on') rows.push({ rule, c });
      }
      const lines = ons.length ? rulesOnLines(ons, d.repoName) : [];
      const max = d.maxCardChars ?? MAX_CARD_CHARS;
      const size = lines.reduce((n, l) => n + l.length + 1, 0);
      if (size > max) throw fail('BAD_REQUEST', 'too-large', `the card that turns these ${ons.length} rules back on would be ${size} characters, over the ${max} a card shows in full`, { hint: 'turn fewer rules back on in one save' });
      if (ons.length && pending && d.broker.card(pending)?.state === 'pending') throw fail('BAD_REQUEST', 'card-pending', 'a card turning rules back on is waiting; decide it first', { cardId: pending, hint: 'Decide in the stack' });

      const batch = `batch:${ulid()}`;
      const applied: RulesApplyResult['applied'] = [];
      // narrowing never waits: written at once, in order, under the rules lock
      try {
        for (const { rule, c } of rows) {
          if (c.op === 'remove') {
            await d.append('approval.rule.revoked', { ruleId: rule.ruleId, repoKey: rule.repoKey, tool: rule.tool, connId: asker.connId }, { connId: asker.connId });
            applied.push({ ruleId: rule.ruleId, op: 'remove' });
          } else {
            const until = c.until == null ? null : new Date(c.until).toISOString();
            await d.append('approval.rule.disabled', { ruleId: rule.ruleId, repoKey: rule.repoKey, tool: rule.tool, until, batch, connId: asker.connId }, { connId: asker.connId });
            applied.push({ ruleId: rule.ruleId, op: 'off', until });
          }
        }
      } catch (err) {
        if (applied.length) changed();
        d.book(); // fold what was written
        throw fail('ENGINE', 'partial', `${applied.length} of ${rows.length} narrowing change(s) were written, then the log refused: ${err instanceof Error ? err.message.slice(0, 160) : 'append failed'}`, { batch, written: applied.map((a) => a.ruleId), hint: 'look at the list again, then save what is left' });
      }
      d.book(); // fold the rows now: the next permission check sees them
      if (applied.length) changed();
      if (!ons.length) return { batch, applied, cardId: null, on: [] };

      let cardId = '';
      const want = ons.map((r) => r.ruleId);
      const card: CardV1 = await d.broker.raise({
        kind: 'strictness',
        requestedBy: asker.principal,
        attended: true,
        detail: { op: RULES_APPLY_OP, batch, changes: want.map((ruleId) => ({ ruleId, op: 'on' })), connId: asker.connId },
        lines,
        decisions: ['allow', 'deny'],
        handOnly: true,
        timeoutMs: d.timeoutMs ?? RULES_APPLY_TIMEOUT_MS,
        effect: async (decision, ctx) => {
          if (decision !== 'allow') return;
          // Aegis: fresh presence only (never a standing grant, a cached unlock or voice)
          if (ctx.presence !== 'fresh') throw fail('FORBIDDEN', 'presence', `turning rules back on takes fresh presence (got ${String(ctx.presence ?? 'none').slice(0, 40)})`);
          await d.lock(async () => {
            const b = d.book();
            const t = b.now();
            let n = 0;
            for (const id of want) {
              // re-validate at allow time: a rule revoked (or already on) while the card waited is skipped
              const rule = b.get(id);
              if (!rule || b.stateOf(id, t).state !== 'off') continue;
              await d.append('approval.rule.enabled', { ruleId: id, repoKey: rule.repoKey, tool: rule.tool, cause: 'human', batch, connId: ctx.connId, cardId }, { connId: ctx.connId });
              n++;
            }
            d.book();
            if (pending === cardId) pending = null;
            if (n) changed();
          });
        },
      });
      cardId = card.cardId;
      pending = cardId;
      return { batch, applied, cardId, on: want };
    });

  const expireDue = (): Promise<number> =>
    d.lock(async () => {
      const b = d.book();
      let n = 0;
      for (const { rule, until } of b.dueExpiries()) {
        await d.append('approval.rule.enabled', { ruleId: rule.ruleId, repoKey: rule.repoKey, tool: rule.tool, cause: 'expired', until }, {});
        n++;
      }
      if (n) {
        d.book();
        changed();
      }
      return n;
    });

  return { apply, expireDue, pendingCardId: () => (pending && d.broker.card(pending)?.state === 'pending' ? pending : null) };
}

/** status.rules (the human class only): every standing rule in the kernel's words, its state on the kernel clock, the presets. */
export function rulesStatus(book: RuleBook, o: { pendingCardId?: string | null; repoName?: (repoKey: string) => string | null } = {}): Record<string, unknown> {
  const now = book.now();
  const t = new Date(now);
  const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, 6, 0, 0, 0).getTime();
  return {
    built: true,
    now: t.toISOString(),
    // C2: the presets' ends, named by the KERNEL clock (the page shows these, never its own clock)
    presets: { hour: new Date(now + 3_600_000).toISOString(), tomorrow: new Date(tomorrow).toISOString(), manual: 'manual' },
    ...(o.pendingCardId ? { pendingCardId: o.pendingCardId } : {}),
    rules: book.list().map((r) => {
      const st = book.stateOf(r.ruleId, now);
      const name = o.repoName?.(r.repoKey) ?? null;
      return {
        ruleId: r.ruleId,
        match: r.match,
        tool: r.tool,
        repoKey: r.repoKey,
        ...(name ? { repoName: name } : {}),
        words: ruleWords(r),
        ...(r.prefix ? { prefix: [...r.prefix] } : {}),
        ...(r.path ? { path: r.path } : {}),
        ...(r.learnedAt ? { learnedAt: r.learnedAt } : {}),
        ...(r.hsid ? { hsid: r.hsid } : {}),
        cardId: r.ruleId,
        state: st.state,
        ...(st.state === 'off' ? { until: st.until, offSince: st.since } : {}),
      };
    }),
  };
}
