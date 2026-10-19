/**
 * @symbol #always-rules
 *
 * #always-rules (spec §3.4 decisions: `always` appends
 * `approval.rule.learned{tool, matchExact}`, S-L1; S25-C2 fresh presence;
 * gui-complete item 2). A standing "always allow" rule is DERIVED, never
 * stored: the RuleBook folds kernel-signed chain rows only (principal = the
 * kernel principal AND keyId a kernel key; any other row — a forged
 * `approval.rule.learned` from a client, a session or a mod — is ignored).
 *
 * A rule exists for card C when, all kernel-signed:
 *   approval.request{card:{cardId:C, kind:'permission'}, tool, tool_input}
 *   approval.decide{cardId:C, decision:'always'}
 *   approval.rule.learned{cardId:C, tool, matchExact:true, repoKey,
 *                         presence ≠ 'cached'}
 * and the request's tool equals the learned row's tool. The rule is keyed
 * (repoKey, tool, inputHash) with inputHash = sha256 over the canonical
 * tool_input (permission.ts inputHash, the same function the card uses):
 * an EXACT match only — a different input or a different repo never matches.
 * The rule id is the card id (`modeRef: 'rule:<cardId>'` on approval.auto).
 *
 * Bounded: at most MAX_TRACKED_REQUESTS permission requests and decisions are
 * remembered for the join (oldest forgotten: a rule whose request fell out of
 * the window is not formed — fail closed, the card is raised again) and at
 * most MAX_RULES rules (oldest dropped first, same fail-closed direction).
 *
 * The learned row's match mode is EXACT only (TD-2026-10-19-528 F2): v1
 * `matchExact:true`, or `match:'exact'`; a row carrying any other `match`
 * value forms no rule (an always-rule never widens).
 *
 * REVOKE (P8-D98, TD-2026-10-19-528 F1): a kernel-signed
 * `approval.rule.revoked{ruleId, repoKey, tool, connId}` (written by the
 * `rules.revoke` human-device verb, socket/rules-revoke.ts) removes the rule
 * and forgets the card's `always` decision, so a replayed learned row for the
 * same card never brings it back. A forged revoked row is ignored like any
 * other forged row. A revoke never widens anything: a later `always` on a
 * NEW card learns a new rule (a new id).
 * `gnomon rules list` reads the same fold offline (rules-cli.ts).
 */
import { inputHash } from './permission.js';

export const MAX_RULES = 1024;
export const MAX_TRACKED_REQUESTS = 4096;
export const RULE_KINDS = Object.freeze(['approval.request', 'approval.decide', 'approval.rule.learned', 'approval.rule.revoked'] as const);

export interface RuleRow {
  seq?: number;
  kind: string;
  principal: string;
  keyId?: unknown;
  payload?: unknown;
}

export interface AlwaysRule {
  /** the card the human decided `always` on */
  ruleId: string;
  repoKey: string;
  tool: string;
  inputHash: string;
  /** seq of the approval.rule.learned row (when the reader knows it) */
  seq: number | null;
  presence: string;
}

export interface KernelTrust {
  principal: string;
  isKernelKey: (keyId: string) => boolean;
}

const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function bump<V>(m: Map<string, V>, k: string, v: V, cap: number): void {
  m.delete(k);
  m.set(k, v);
  while (m.size > cap) m.delete(m.keys().next().value!);
}

export class RuleBook {
  readonly #trust: KernelTrust;
  readonly #requests = new Map<string, { tool: string; inputHash: string }>();
  readonly #always = new Set<string>();
  readonly #rules = new Map<string, AlwaysRule>();
  /** the last seq folded (incremental readers resume after it) */
  lastSeq = 0;

  constructor(trust: KernelTrust) {
    this.#trust = trust;
  }

  /** Fold one chain row. Rows not signed by the kernel are ignored. */
  fold(r: RuleRow): void {
    if (typeof r.seq === 'number' && r.seq > this.lastSeq) this.lastSeq = r.seq;
    if (r.principal !== this.#trust.principal || typeof r.keyId !== 'string' || !this.#trust.isKernelKey(r.keyId)) return;
    const p = obj(r.payload);
    if (!p) return;
    if (r.kind === 'approval.request') {
      const card = obj(p.card);
      if (!card || card.kind !== 'permission' || typeof card.cardId !== 'string' || typeof p.tool !== 'string' || !('tool_input' in p)) return;
      bump(this.#requests, card.cardId, { tool: p.tool, inputHash: inputHash(p.tool_input) }, MAX_TRACKED_REQUESTS);
    } else if (r.kind === 'approval.decide') {
      if (p.decision !== 'always' || typeof p.cardId !== 'string') return;
      this.#always.add(p.cardId);
      while (this.#always.size > MAX_TRACKED_REQUESTS) this.#always.delete(this.#always.values().next().value!);
    } else if (r.kind === 'approval.rule.learned') {
      const cardId = p.cardId;
      const exact = 'match' in p ? p.match === 'exact' : p.matchExact === true; // F2: exact only
      if (typeof cardId !== 'string' || !exact || typeof p.tool !== 'string' || typeof p.repoKey !== 'string' || p.presence === 'cached') return;
      const req = this.#requests.get(cardId);
      if (!req || req.tool !== p.tool || !this.#always.has(cardId)) return;
      bump(this.#rules, cardId, { ruleId: cardId, repoKey: p.repoKey, tool: p.tool, inputHash: req.inputHash, seq: typeof r.seq === 'number' ? r.seq : null, presence: String(p.presence ?? 'fresh') }, MAX_RULES);
    } else if (r.kind === 'approval.rule.revoked') {
      if (typeof p.ruleId !== 'string') return;
      this.#rules.delete(p.ruleId);
      this.#always.delete(p.ruleId);
    }
  }

  /** The standing rule with this id, or null (revoked or never learned). */
  get(ruleId: string): AlwaysRule | null {
    return this.#rules.get(ruleId) ?? null;
  }

  /** The rule an exact (repoKey, tool, inputHash) matches, or null. */
  match(repoKey: string, tool: string, hash: string): AlwaysRule | null {
    for (const r of this.#rules.values()) if (r.repoKey === repoKey && r.tool === tool && r.inputHash === hash) return r;
    return null;
  }

  list(): AlwaysRule[] {
    return [...this.#rules.values()];
  }

  /** Everything up to `seq` has been scanned (rule kind or not): the next read starts after it. */
  advanceTo(seq: number): void {
    if (seq > this.lastSeq) this.lastSeq = seq;
  }
}

/** A chain reader for catchUp: the released head, and the RULE_KINDS rows in [fromSeq, toSeq]. */
export interface RuleSource {
  head(): number;
  read(fromSeq: number, toSeq: number): Iterable<RuleRow>;
}

/**
 * Aegis C2: fold the rows appended since the last catch-up and advance past
 * EVERY row up to the head captured first — not only past rule kinds — so a
 * chain of non-rule rows is scanned once, never on each request. Rows
 * appended after the head was captured are read next time. Returns whether
 * the source was read at all.
 */
export function catchUp(book: RuleBook, src: RuleSource): boolean {
  const head = src.head();
  if (head <= book.lastSeq) return false;
  for (const r of src.read(book.lastSeq + 1, head)) book.fold(r);
  book.advanceTo(head);
  return true;
}
