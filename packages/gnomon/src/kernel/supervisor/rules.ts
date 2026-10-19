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
 * REVOKE is not built: it needs a new event kind (`approval.rule.revoked`),
 * which moves clientApiId — reported, not added (the task's STOP rule).
 * `gnomon rules list` reads the same fold offline (rules-cli.ts).
 */
import { inputHash } from './permission.js';

export const MAX_RULES = 1024;
export const MAX_TRACKED_REQUESTS = 4096;
export const RULE_KINDS = Object.freeze(['approval.request', 'approval.decide', 'approval.rule.learned'] as const);

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
      if (typeof cardId !== 'string' || p.matchExact !== true || typeof p.tool !== 'string' || typeof p.repoKey !== 'string' || p.presence === 'cached') return;
      const req = this.#requests.get(cardId);
      if (!req || req.tool !== p.tool || !this.#always.has(cardId)) return;
      bump(this.#rules, cardId, { ruleId: cardId, repoKey: p.repoKey, tool: p.tool, inputHash: req.inputHash, seq: typeof r.seq === 'number' ? r.seq : null, presence: String(p.presence ?? 'fresh') }, MAX_RULES);
    }
  }

  /** The rule an exact (repoKey, tool, inputHash) matches, or null. */
  match(repoKey: string, tool: string, hash: string): AlwaysRule | null {
    for (const r of this.#rules.values()) if (r.repoKey === repoKey && r.tool === tool && r.inputHash === hash) return r;
    return null;
  }

  list(): AlwaysRule[] {
    return [...this.#rules.values()];
  }
}
