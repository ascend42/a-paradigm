/**
 * @symbol #session-names
 *
 * #session-names (8.0:session-rename, spec §3.3 "Session names"): the human renames a session. A fold over the
 * kernel-signed log, so a name survives a restart and a replay with no state of its own:
 *
 *   - `session.open{hsid, by}` (kernel principal) records who owns the hsid — the Claude lane and the local lane both
 *     write `by`. An hsid this fold never saw opened cannot be renamed (NOT_FOUND).
 *   - `session.renamed{hsid, name}` (kernel principal, validateKindPayload) sets the name; `''` clears it (the GUI
 *     shows the derived title again). The last row wins.
 *
 * `rename(asker, payload)` serves the human's `log.append{kind:'request.session.rename', payload:{hsid, name}}` (the
 * dispatcher routes it from a first-party gui/device human connection only; refused here again for any other
 * asker). The payload is closed to {hsid, name}; the name is normalised by contracts normalizeSessionName (the ONE
 * §4.5 sanitizer, whitespace folded, trimmed, ≤ SESSION_NAME_MAX code points; a control or format character is
 * refused, never dropped). The session must be one THIS human opened (live or ended: an ended session can be named
 * too). The kernel writes `request.session.rename` then `session.renamed`, both with the normalised name.
 *
 * A NAME IS DISPLAY TEXT, NOT A CAPABILITY: nothing in the kernel routes, grants, scopes or permits by it. It never
 * reaches a path (hsids carry ':' and names carry anything), a session child, a prompt or a mod.
 */
import { HSID_PATTERN, normalizeSessionName, SESSION_NAME_INPUT_MAX, SESSION_NAME_MAX, validateKindPayload } from '@a-company/gnomon-contracts';
import { RpcRefusal } from '../socket/rpc.js';

/** Bounded memory: owners and names of the most recent sessions (an older hsid falls out and is refused NOT_FOUND). */
export const SESSION_NAMES_CAP = 8192;

/** The persistent rows the fold reads at boot (log.read kinds). */
export const SESSION_NAME_SEED_KINDS: readonly string[] = Object.freeze(['session.open', 'session.renamed']);

export interface NameRow {
  kind: string;
  principal?: string;
  session?: string | null;
  payload?: unknown;
}

export interface RenameAsker {
  connId: string;
  principal: string | undefined;
  principalClass: string;
  credential: string | undefined;
}

export interface SessionNamesOptions {
  kernelPrincipal: string;
  /** append a kernel row (as the kernel principal); resolves once it is committed */
  append: (kind: string, payload: Record<string, unknown>, ids: { session: string; connId: string }) => Promise<void>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function capSet<K, V>(m: Map<K, V>, k: K, v: V): void {
  m.delete(k); // re-insert: the most recent stays
  m.set(k, v);
  while (m.size > SESSION_NAMES_CAP) m.delete(m.keys().next().value as K);
}

export class SessionNames {
  readonly #o: SessionNamesOptions;
  readonly #owners = new Map<string, string>();
  readonly #names = new Map<string, string>();

  constructor(o: SessionNamesOptions) {
    this.#o = o;
  }

  /** Boot: fold the persistent rows (SESSION_NAME_SEED_KINDS) read from the log, in seq order. */
  seed(rows: Iterable<NameRow>): void {
    for (const r of rows) this.observe(r);
  }

  /** One committed row. Only the kernel's own rows count; a malformed one is ignored (never invents a name). */
  observe(e: NameRow): void {
    if (e.principal !== this.#o.kernelPrincipal || !isObj(e.payload)) return;
    const p = e.payload;
    if (e.kind === 'session.open') {
      if (typeof p.hsid === 'string' && HSID_PATTERN.test(p.hsid) && typeof p.by === 'string' && p.by) capSet(this.#owners, p.hsid, p.by);
    } else if (e.kind === 'session.renamed') {
      if (validateKindPayload('session.renamed', p).length) return;
      const hsid = p.hsid as string;
      const name = p.name as string;
      if (name) capSet(this.#names, hsid, name);
      else this.#names.delete(hsid);
    }
  }

  /** The human's name of a session, or null (the derived title shows). Display only. */
  nameOf(hsid: string): string | null {
    return this.#names.get(hsid) ?? null;
  }

  /** status.sessionNames: the names of the sessions `principal` owns, newest rename last. */
  namesFor(principal: string): Array<{ hsid: string; name: string }> {
    return [...this.#names].filter(([h]) => this.#owners.get(h) === principal).map(([hsid, name]) => ({ hsid, name }));
  }

  /** request.session.rename{hsid, name} from the human (see the header). Returns the name now on record (null = reset). */
  async rename(asker: RenameAsker, payload: unknown): Promise<{ hsid: string; name: string | null; changed: boolean }> {
    if (asker.principalClass !== 'human' || (asker.credential !== 'gui' && asker.credential !== 'device') || !asker.principal) {
      throw new RpcRefusal('FORBIDDEN', 'matrix', "request.session.rename is the human's, on a gui or device connection");
    }
    if (!isObj(payload)) throw new RpcRefusal('BAD_REQUEST', 'bad-params', 'request.session.rename takes {hsid, name}');
    const extra = Object.keys(payload).filter((k) => k !== 'hsid' && k !== 'name');
    if (extra.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `request.session.rename takes {hsid, name} (unknown: ${extra.slice(0, 4).join(', ')})`);
    const { hsid, name: raw } = payload;
    if (typeof hsid !== 'string' || !HSID_PATTERN.test(hsid)) throw new RpcRefusal('BAD_REQUEST', 'bad-params', 'request.session.rename needs an hsid', { field: 'hsid' });
    const n = normalizeSessionName(raw);
    if (!n.ok) {
      const why = n.why === 'too-long' ? `at most ${SESSION_NAME_MAX} characters (${SESSION_NAME_INPUT_MAX} before trimming)` : n.why === 'not-a-string' ? 'a string' : `no ${n.why.replace('-', ' ')}`;
      throw new RpcRefusal('BAD_REQUEST', 'bad-params', `request.session.rename: the name must be ${why}`, { field: 'name', why: n.why });
    }
    const owner = this.#owners.get(hsid);
    if (owner === undefined || owner !== asker.principal) throw new RpcRefusal('NOT_FOUND', 'not-found', 'no such session for this principal');
    const before = this.nameOf(hsid);
    const row = { hsid, name: n.name };
    for (const kind of ['request.session.rename', 'session.renamed']) {
      const errs = validateKindPayload(kind, row);
      if (errs.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `${kind}: ${errs.slice(0, 3).join('; ')}`);
    }
    await this.#o.append('request.session.rename', { ...row }, { session: hsid, connId: asker.connId });
    await this.#o.append('session.renamed', { ...row }, { session: hsid, connId: asker.connId });
    this.observe({ kind: 'session.renamed', principal: this.#o.kernelPrincipal, payload: row });
    return { hsid, name: n.name || null, changed: before !== (n.name || null) };
  }
}
