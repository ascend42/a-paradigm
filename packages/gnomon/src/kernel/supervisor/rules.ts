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
 * The learned row's match mode (TD-2026-10-19-528 F2, amended TD-2026-10-20-294):
 * v1 `matchExact:true` or `match:'exact'` (exact, as above), or
 * `match:'prefix', prefix:[1..3 words]` — a PREFIX rule, formed only when the
 * kernel-signed request is a Bash card whose command is ONE literal simple
 * command (shell-readonly simpleArgv) starting with the prefix AND the
 * kernel-signed `approval.decide{always}` for the card carries the SAME
 * `scope:{kind:'prefix', prefix}` (the scope its decisionSig bound). A later
 * Bash input matches it only when simpleArgv(command) succeeds (no ; && || |
 * & newline, substitution, parameter, glob, redirection or assignment), argv
 * starts with the prefix word for word, the repoKey and tool are the same and
 * the input has no key besides command, description and timeout. A prefix
 * rule widens only within a single literal simple command. Any other `match`
 * value forms no rule.
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
import type { KernelLog } from '../log/index.js';
import { inputHash } from './permission.js';
import { simpleArgv } from './shell-readonly.js';

/** Input keys a prefix rule tolerates besides `command` (anything else, e.g. run_in_background, raises the card). */
export const PREFIX_RULE_INPUT_KEYS: ReadonlySet<string> = new Set(['command', 'description', 'timeout']);

/** The argv of a Bash input whose command is one literal simple command, else null. */
export function bashArgvOfInput(toolInput: unknown): string[] | null {
  if (toolInput === null || typeof toolInput !== 'object' || Array.isArray(toolInput)) return null;
  const o = toolInput as Record<string, unknown>;
  if (typeof o.command !== 'string' || Object.keys(o).some((k) => !PREFIX_RULE_INPUT_KEYS.has(k))) return null;
  return simpleArgv(o.command);
}

const startsWith = (argv: readonly string[], prefix: readonly string[]): boolean => prefix.length > 0 && prefix.length <= argv.length && prefix.every((w, i) => argv[i] === w);
const prefixOk = (v: unknown): v is string[] => Array.isArray(v) && v.length >= 1 && v.length <= 3 && v.every((w) => typeof w === 'string' && w.length > 0 && w.length <= 128);

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
  /** 'exact' (inputHash) or 'prefix' (a Bash rule over one literal simple command starting with `prefix`) */
  match: 'exact' | 'prefix';
  /** prefix rules only: the literal argv words */
  prefix?: string[];
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
  readonly #requests = new Map<string, { tool: string; inputHash: string; argv: string[] | null }>();
  /** cardId → the decide row's scope key ('exact' or the canonical prefix JSON) */
  readonly #always = new Map<string, string>();
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
      bump(this.#requests, card.cardId, { tool: p.tool, inputHash: inputHash(p.tool_input), argv: p.tool === 'Bash' && obj(p.tool_input) && typeof obj(p.tool_input)!.command === 'string' ? simpleArgv(String(obj(p.tool_input)!.command)) : null }, MAX_TRACKED_REQUESTS);
    } else if (r.kind === 'approval.decide') {
      if (p.decision !== 'always' || typeof p.cardId !== 'string') return;
      let key = 'exact';
      if (p.scope !== undefined) {
        const sc = obj(p.scope);
        if (!sc || sc.kind !== 'prefix' || !prefixOk(sc.prefix) || Object.keys(sc).length !== 2) return; // a malformed scope learns nothing
        key = JSON.stringify(sc.prefix);
      }
      bump(this.#always, p.cardId, key, MAX_TRACKED_REQUESTS);
    } else if (r.kind === 'approval.rule.learned') {
      const cardId = p.cardId;
      const isPrefix = p.match === 'prefix';
      const exact = 'match' in p ? p.match === 'exact' : p.matchExact === true;
      if (typeof cardId !== 'string' || (!exact && !isPrefix) || typeof p.tool !== 'string' || typeof p.repoKey !== 'string' || p.presence === 'cached') return;
      const req = this.#requests.get(cardId);
      const decided = this.#always.get(cardId);
      if (!req || req.tool !== p.tool || decided === undefined) return;
      const base = { ruleId: cardId, repoKey: p.repoKey, tool: p.tool, inputHash: req.inputHash, seq: typeof r.seq === 'number' ? r.seq : null, presence: String(p.presence ?? 'fresh') };
      if (exact) {
        if (decided !== 'exact') return; // a scoped decision never learns a different rule
        bump(this.#rules, cardId, { ...base, match: 'exact' }, MAX_RULES);
        return;
      }
      // prefix: Bash only, the decide row's scope is the same prefix, and the shown command starts with it
      if (p.tool !== 'Bash' || !prefixOk(p.prefix) || decided !== JSON.stringify(p.prefix) || !req.argv || !startsWith(req.argv, p.prefix)) return;
      bump(this.#rules, cardId, { ...base, match: 'prefix', prefix: [...p.prefix] }, MAX_RULES);
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

  /**
   * The rule (repoKey, tool, input) matches, or null: an exact rule by inputHash; a prefix rule only when the
   * input is a Bash command that is one literal simple command whose argv starts with the prefix.
   */
  match(repoKey: string, tool: string, hash: string, toolInput?: unknown): AlwaysRule | null {
    for (const r of this.#rules.values()) if (r.match === 'exact' && r.repoKey === repoKey && r.tool === tool && r.inputHash === hash) return r;
    if (tool !== 'Bash' || toolInput === undefined) return null;
    let argv: string[] | null = null;
    for (const r of this.#rules.values()) {
      if (r.match !== 'prefix' || r.repoKey !== repoKey || r.tool !== tool || !r.prefix) continue;
      argv ??= bashArgvOfInput(toolInput);
      if (!argv) return null;
      if (startsWith(argv, r.prefix)) return r;
    }
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

/**
 * A chain reader for catchUp: `head()` MUST be a seq every row at or below
 * which `read` can return — the RELEASED head (kernel-log.ts releasedHead,
 * D83), never the committed tip. A critical row waiting on its anchors hides
 * itself and every later row from `log.read`; a tip-valued head would make
 * catchUp advance past rows it never saw and skip them forever (Aegis H1: a
 * revoke appended while a critical approval.decide is pending was never
 * folded). Released heads only grow, so a row hidden now is read next time.
 */
export interface RuleSource {
  head(): number;
  read(fromSeq: number, toSeq: number): Iterable<RuleRow>;
}

/** The kernel log as a RuleSource: released head + the RULE_KINDS rows in full view (shared by the daemon and its tests). */
export function ruleSourceOf(log: Pick<KernelLog, 'releasedHead' | 'read'>): RuleSource {
  return {
    head: () => log.releasedHead(),
    read: function* (fromSeq, toSeq) {
      for (const v of log.read({ reader: { class: 'human' }, fromSeq, toSeq, kinds: RULE_KINDS })) {
        if (v.view === 'full') yield { seq: v.event.seq, kind: v.event.kind, principal: v.event.principal, keyId: v.event.keyId, payload: v.event.payload };
      }
    },
  };
}

/**
 * Aegis C2: fold the rows appended since the last catch-up and advance past
 * EVERY row up to the head captured first — not only past rule kinds — so a
 * chain of non-rule rows is scanned once, never on each request. Rows
 * appended after the head was captured are read next time. Returns whether
 * the source was read at all. Aegis H1: the head is the source's RELEASED
 * head (RuleSource), so the advance never passes a row the read could not
 * return; a row seq above the captured head is never folded early either.
 */
export function catchUp(book: Pick<RuleBook, 'lastSeq' | 'fold' | 'advanceTo'>, src: RuleSource): boolean {
  const head = src.head();
  if (head <= book.lastSeq) return false;
  for (const r of src.read(book.lastSeq + 1, head)) {
    if (r.seq !== undefined && r.seq > head) break;
    book.fold(r);
  }
  book.advanceTo(head);
  return true;
}
