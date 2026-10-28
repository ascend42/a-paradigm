/**
 * @symbol #mcp-servers
 *
 * Per-server trust for LOCAL sessions (TD-2026-10-27-833 slice C5'a1; Aegis's design, Arky's amendments). How much a
 * local session believes an MCP server's OWN tool labels (#capability-index): untrusted (the default: every tool is
 * mutate and takes a card), trusted (the human's one press: tools/list annotations and _meta believed, so a
 * readOnlyHint && openWorldHint:false tool is `read` and runs with no card; op-annotation resources are NOT read) or
 * first-party (the staged Paradigm pin only, never from here).
 *
 *   storage   NO file. Trust lives in KERNEL-signed tool.trust rows on the chain; TrustBook folds them and ignores any
 *             row not signed with the kernel's principal and one of its keys (like RuleBook and StandingGrantBook). The
 *             store's old `trust` field is never read (#mcp-servers composeLocal) and the next write drops it.
 *   binding   sha256(canonicalJson({id, launchHash, pluginVersion, toolsHash})): launchHash is the #mcp-servers launch
 *             hash (declHash, keyed; it excludes the trust itself and the repo, so setting trust never moves it),
 *             toolsHash covers the tools sorted by name, each {name, inputSchema, annotations, _meta op-annotations}
 *             (descriptions are left out so the hash does not flap).
 *   drops     the pool re-checks the binding at index time, on a cache hit, on the first spawn (a trusted server lists
 *             once more) and on list_changed. A mismatch drops trust EVERYWHERE: one tool.trust{op:'dropped', why}
 *             row, then every local session re-narrows (LocalLane, setTools with an ackId) so cards come back.
 *   order     the daemon catches the book up BEFORE the first index or pool (next to the RuleBook catch-up); any later
 *             fold tells the subscribers (LocalLane re-narrows).
 */
import { canonicalJson, sha256Tagged, TOOL_BROKER_SERVER_PATTERN, TOOL_TRUST_ID_PATTERN, TOOL_TRUST_LAUNCH_PATTERN, type ToolTrustWhy } from '@a-company/gnomon-contracts';
import type { KernelLog } from '../log/index.js';
import { catchUp, type RuleRow, type RuleSource } from '../supervisor/rules.js';
import { OP_ANNOTATIONS_META } from './capability-index.js';

export const TRUST_KINDS: readonly string[] = Object.freeze(['tool.trust']);
/** At most this many trusted servers are tracked (oldest dropped first: it only narrows). */
export const TRUST_MAX = 256;
const SHA = /^sha256:[0-9a-f]{64}$/;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** One server's live trust, as the last kernel-signed `set` row holds it. */
export interface TrustEntry {
  id: string;
  label: string;
  binding: string;
  launchHash: string;
  toolsHash: string;
  seq: number;
}

/**
 * toolsHash: the tools sorted by name, each {name, inputSchema, annotations, op-annotations _meta}; descriptions and
 * every other _meta key are left out (they do not change what the kernel believes).
 */
export function toolsHashOf(tools: ReadonlyArray<Record<string, unknown>>): string {
  const rows = tools
    .filter((t) => typeof t.name === 'string')
    .map((t) => ({ name: t.name as string, inputSchema: isObj(t.inputSchema) ? t.inputSchema : null, annotations: isObj(t.annotations) ? t.annotations : null, ops: isObj(t._meta) && isObj(t._meta[OP_ANNOTATIONS_META]) ? t._meta[OP_ANNOTATIONS_META] : null }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  try {
    return sha256Tagged(canonicalJson(rows));
  } catch {
    // a value canonicalJson refuses (never plain JSON from a server): a hash that matches nothing
    return sha256Tagged(`unhashable:${Date.now()}:${Math.random()}`);
  }
}

/** The trust binding of one listed server. */
export function bindingOf(b: { id: string; launchHash: string; pluginVersion: string | null; toolsHash: string }): string {
  return sha256Tagged(canonicalJson({ id: b.id, launchHash: b.launchHash, pluginVersion: b.pluginVersion, toolsHash: b.toolsHash }));
}

export interface KernelSigner {
  principal: string;
  isKernelKey: (keyId: string) => boolean;
}

/** The trust of each server, DERIVED from kernel-signed tool.trust rows only. */
export class TrustBook {
  readonly #k: KernelSigner;
  readonly #m = new Map<string, TrustEntry>();
  readonly #changed = new Set<string>();
  lastSeq = 0;

  constructor(k: KernelSigner) {
    this.#k = k;
  }

  fold(r: RuleRow): void {
    if (typeof r.seq === 'number' && r.seq > this.lastSeq) this.lastSeq = r.seq;
    if (r.kind !== 'tool.trust') return;
    // a row not signed by the kernel's principal AND one of its keys widens nothing (a forged row is ignored)
    if (r.principal !== this.#k.principal || typeof r.keyId !== 'string' || !this.#k.isKernelKey(r.keyId)) return;
    const p = isObj(r.payload) ? r.payload : null;
    if (!p || typeof p.id !== 'string' || !TOOL_TRUST_ID_PATTERN.test(p.id)) return;
    if (p.op === 'set') {
      if (p.why !== 'human' || typeof p.label !== 'string' || !TOOL_BROKER_SERVER_PATTERN.test(p.label) || typeof p.binding !== 'string' || !SHA.test(p.binding)) return;
      if (typeof p.launchHash !== 'string' || !TOOL_TRUST_LAUNCH_PATTERN.test(p.launchHash) || typeof p.toolsHash !== 'string' || !SHA.test(p.toolsHash)) return;
      this.#m.delete(p.id);
      this.#m.set(p.id, { id: p.id, label: p.label, binding: p.binding, launchHash: p.launchHash, toolsHash: p.toolsHash, seq: typeof r.seq === 'number' ? r.seq : 0 });
      while (this.#m.size > TRUST_MAX) this.#m.delete(this.#m.keys().next().value!);
      this.#changed.add(p.id);
    } else if (p.op === 'cleared' || p.op === 'dropped') {
      // any well-signed narrowing ends the trust (a drop for an older binding too: it only narrows)
      if (this.#m.delete(p.id)) this.#changed.add(p.id);
    }
  }

  advanceTo(seq: number): void {
    if (seq > this.lastSeq) this.lastSeq = seq;
  }

  of(id: string): TrustEntry | null {
    const e = this.#m.get(id);
    return e ? { ...e } : null;
  }

  all(): TrustEntry[] {
    return [...this.#m.values()].map((e) => ({ ...e }));
  }

  /** The ids whose trust changed since the last call. */
  drainChanged(): string[] {
    const out = [...this.#changed];
    this.#changed.clear();
    return out;
  }
}

/** The kernel log as the source of tool.trust rows (released head, full view), like ruleSourceOf. */
export function trustSourceOf(log: Pick<KernelLog, 'releasedHead' | 'read'>): RuleSource {
  return {
    head: () => log.releasedHead(),
    read: function* (fromSeq, toSeq) {
      for (const v of log.read({ reader: { class: 'human' }, fromSeq, toSeq, kinds: [...TRUST_KINDS] })) {
        if (v.view === 'full') yield { seq: v.event.seq, kind: v.event.kind, principal: v.event.principal, keyId: v.event.keyId, payload: v.event.payload };
      }
    },
  };
}

/** What the pool reads (#local-mcp-client): the live trust of a server id, and the drop it reports. */
export interface PoolTrust {
  of(id: string): Pick<TrustEntry, 'binding' | 'launchHash' | 'toolsHash' | 'label'> | null;
  drop(id: string, why: Extract<ToolTrustWhy, 'launch-changed' | 'tools-changed' | 'disabled'>): void;
}

export interface McpTrustOptions extends KernelSigner {
  source: RuleSource;
  /** writes a kernel-signed row (rejects when it was not written) */
  append: (kind: string, payload: Record<string, unknown>) => Promise<void>;
  /** told when a row could not be written (names only) */
  onError?: (op: string, id: string) => void;
}

/**
 * The kernel's one TrustBook and its writer: the pool reads `of`, request.mcp.trust writes `set`/`clear`, a binding
 * mismatch or a disable writes `drop`. Every read catches the book up first (a row written anywhere is seen at once).
 */
export class McpTrust implements PoolTrust {
  readonly book: TrustBook;
  readonly #o: McpTrustOptions;
  readonly #listeners = new Set<(id: string) => void>();
  /** `${id}|${binding}` drops being written (one row per drop, however many sessions see it) */
  readonly #dropping = new Set<string>();
  /** id → the binding a drop was asked for: hidden at once (fail closed), even before or without its row */
  readonly #hidden = new Map<string, string>();

  constructor(o: McpTrustOptions) {
    this.#o = o;
    this.book = new TrustBook(o);
  }

  /** Catch up with the chain; every id whose trust changed is told to the subscribers. */
  sync(): void {
    catchUp(this.book, this.#o.source);
    this.#notify(this.book.drainChanged());
  }

  /** Subscribers hear of a change AFTER the current call returns (never re-entered from inside a pool's narrow). */
  #notify(ids: readonly string[]): void {
    if (!ids.length || !this.#listeners.size) return;
    queueMicrotask(() => {
      for (const id of ids) for (const l of [...this.#listeners]) {
        try {
          l(id);
        } catch {
          /* a listener never breaks the book */
        }
      }
    });
  }

  subscribe(fn: (id: string) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  of(id: string): TrustEntry | null {
    this.sync();
    const e = this.book.of(id);
    return e && this.#hidden.get(id) !== e.binding ? e : null;
  }

  all(): TrustEntry[] {
    this.sync();
    return this.book.all().filter((e) => this.#hidden.get(e.id) !== e.binding);
  }

  /** The human's commit (request.mcp.trust): one set row. */
  async set(e: { id: string; label: string; binding: string; launchHash: string; toolsHash: string }): Promise<void> {
    await this.#o.append('tool.trust', { id: e.id, label: e.label, op: 'set', binding: e.binding, why: 'human', launchHash: e.launchHash, toolsHash: e.toolsHash });
    this.sync();
  }

  /** The human's clear: one cleared row (false when the server was not trusted). */
  async clear(id: string): Promise<boolean> {
    const e = this.of(id);
    if (!e) return false;
    await this.#o.append('tool.trust', { id, label: e.label, op: 'cleared', binding: e.binding, why: 'human' });
    this.sync();
    return true;
  }

  /** A binding mismatch or a disable: one dropped row (fire and forget; the caller already narrowed). */
  drop(id: string, why: 'launch-changed' | 'tools-changed' | 'disabled'): void {
    const e = this.of(id);
    if (!e) return;
    // hidden at once: every session's next trustLive answers untrusted before the row lands (and if it never does)
    this.#hidden.set(id, e.binding);
    this.#notify([id]);
    const k = `${id}|${e.binding}`;
    if (this.#dropping.has(k)) return;
    this.#dropping.add(k);
    void this.#o
      .append('tool.trust', { id, label: e.label, op: 'dropped', binding: e.binding, why })
      .then(() => this.sync())
      .catch(() => this.#o.onError?.('dropped', id))
      .finally(() => this.#dropping.delete(k));
  }
}
