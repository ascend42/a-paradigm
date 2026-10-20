/**
 * @symbol #offer-router
 * @symbol $offer-handoff
 * @symbol ^offer-accept
 *
 * The Desk's offer router (TD-2026-10-20-812, slice S1): a fold over committed log rows (a log.onCommit observer, like
 * the speakable projector) plus the two human requests.
 *
 * $offer-handoff:
 *   1. A turn ends (turn.result). The main-chain assistant text of that turn is parsed with offerBlockOf (S0, the one
 *      parser shared with the GUI). No block, two blocks, or a malformed block ⇒ nothing (the reply is plain text).
 *   2. BUDGET: at most one per reply (one evaluation per turn end); none while the session still has a turn streaming
 *      (another turn.sent is outstanding); none while the session has a pending approval card.
 *   3. GATE (Aegis D3): the mod is installed, granted, unpaused (DeskMods), not muted for this hsid (not-now / stop-here)
 *      nor for the session's repo (request.offer.mute), and `kind` is one of ITS declared offers. phase, title and
 *      contextIn are COPIED from the manifest offer spec, never taken from the block; only the question is model text.
 *   4. The router returns the KERNEL-owned offer.shown row; the daemon appends it as the kernel principal.
 *   5. ^offer-accept: request.offer.decide{offerId, decision} from the HUMAN on a gui/device connection only (the
 *      dispatcher stamps the connection; Aegis D1). The offer must be live (its session running, owned by the asker),
 *      the latest shown for that hsid, and undecided: exactly one decision per offer, a replay is refused. The kernel
 *      writes request.offer.decide and offer.decided; on `open` it sends a KERNEL-templated turn as the human
 *      ("Open <title>: use the <handoffTool> tool.", from the manifest, never model text; session.inject origin kernel).
 *   6. offer.kept (the founder's definition, the A6 metric): after `open`, the mod's declared handoffTool, called on that
 *      mod's own server (`mcp__gnomon-<mod>__<handoffTool>`), completes without error in the same hsid. Once per offer.
 *
 * MUTES: offer.decided{not-now} quiets that mod for the rest of the hsid (L4); {stop-here} quiets every mod for the
 * hsid; request.offer.mute{mod, scope:'repo', repo, muted} (A3) is folded per repo and survives restarts (seed()).
 */

import {
  mintId,
  offerBlockOf,
  validateKindPayload,
  type OfferDecision,
  type OfferSpecV1,
} from '@a-company/gnomon-contracts';
import { parseStreamLine } from '../../adapters/claude-code/adapter.js';
import { RpcRefusal } from '../socket/rpc.js';
import { deskGuidance } from './desk-guidance.js';
import { serverNameOf, type DeskMod } from './mcp-passthrough.js';

/** The rows the router folds. */
export const OFFER_ROUTER_KINDS: readonly string[] = Object.freeze([
  'turn.sent', 'turn.event', 'turn.result', 'session.exited',
  'offer.shown', 'offer.decided', 'offer.kept', 'request.offer.mute',
]);
/** The rows seed() reads at boot (the persistent state: repo mutes and the offers of resumed sessions). */
export const OFFER_SEED_KINDS: readonly string[] = Object.freeze(['offer.shown', 'offer.decided', 'offer.kept', 'request.offer.mute']);

/** The kernel template of an `open` turn (manifest fields only). */
export function openText(title: string, handoffTool: string): string {
  return `Open ${title}: use the ${handoffTool} tool.`;
}

/** The repo scope of a session (`repo:<16 hex>`) from its repoKey (`sha256:<64 hex>`, repo-hooks.ts repoKeyOf). */
export function deskRepoScope(repoKey: string): string {
  return `repo:${repoKey.replace(/^sha256:/, '').slice(0, 16)}`;
}

export interface RouterRow {
  kind: string;
  payload: Record<string, unknown>;
  session: string;
}

export interface CommittedRow {
  seq?: number;
  kind: string;
  principal?: string;
  session?: string | null;
  payload?: unknown;
}

export interface OfferAsker {
  connId: string;
  principal: string | undefined;
  principalClass: string;
  credential: string | undefined;
}

export interface OfferRouterOptions {
  kernelPrincipal: string;
  /** installed, granted, unpaused mods (DeskMods.list) */
  mods: () => readonly DeskMod[];
  /** a LIVE session's repo scope (repo:<16 hex>), or null */
  repoScopeOf: (hsid: string) => string | null;
  /** a LIVE session's owner principal, or undefined */
  ownerOf: (hsid: string) => string | undefined;
  /** does the session have a pending approval card? */
  pendingCard: (hsid: string) => boolean;
  /** append a kernel row (as the kernel principal) */
  append: (kind: string, payload: Record<string, unknown>, ids: { session?: string; connId?: string }) => Promise<void>;
  /** send a kernel-templated turn as the human (session.inject origin kernel) */
  send: (principal: string, hsid: string, text: string) => Promise<unknown>;
  mintOfferId?: () => string;
}

interface OfferState {
  offerId: string;
  hsid: string;
  mod: string;
  kind: string;
  decided: OfferDecision | null;
  kept: boolean;
  /** the namespaced handoff tool, set on `open` */
  watchTool: string[] | null;
}

interface SessionState {
  turns: string[];
  texts: string[];
  muted: Set<string>;
  stopped: boolean;
  latest: string | null;
  /** tool_use id → offerId, for kept */
  calls: Map<string, string>;
}


function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** The main-chain assistant text of one stream line (null for anything else). */
function assistantText(line: string): string | null {
  let o: unknown;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObj(o) || o.type !== 'assistant' || (o.parent_tool_use_id !== undefined && o.parent_tool_use_id !== null)) return null;
  const content = isObj(o.message) ? o.message.content : undefined;
  if (!Array.isArray(content)) return null;
  const t = content.filter((b) => isObj(b) && b.type === 'text' && typeof b.text === 'string').map((b) => (b as { text: string }).text);
  return t.length ? t.join('\n\n') : null;
}

const MAX_TURN_TEXT = 262_144;
const MAX_SESSIONS = 512;
const MAX_OFFERS = 4096;

export class OfferRouter {
  readonly #o: OfferRouterOptions;
  readonly #sessions = new Map<string, SessionState>();
  readonly #offers = new Map<string, OfferState>();
  /** repo scope → muted mods */
  readonly #repoMutes = new Map<string, Set<string>>();
  /** offerIds with a decision in flight (replays refused before the row commits) */
  readonly #deciding = new Set<string>();

  constructor(o: OfferRouterOptions) {
    this.#o = o;
  }

  #s(hsid: string): SessionState {
    let s = this.#sessions.get(hsid);
    if (!s) {
      if (this.#sessions.size >= MAX_SESSIONS) this.#sessions.delete(this.#sessions.keys().next().value!);
      s = { turns: [], texts: [], muted: new Set(), stopped: false, latest: null, calls: new Map() };
      this.#sessions.set(hsid, s);
    }
    return s;
  }

  #kernel(e: CommittedRow): boolean {
    return e.principal === undefined || e.principal === this.#o.kernelPrincipal;
  }

  /** Boot: fold the persistent rows (OFFER_SEED_KINDS) read from the log. */
  seed(rows: Iterable<CommittedRow>): void {
    for (const r of rows) if (OFFER_SEED_KINDS.includes(r.kind)) this.observe(r);
  }

  repoMuted(repo: string | null, mod: string): boolean {
    return repo !== null && (this.#repoMutes.get(repo)?.has(mod) ?? false);
  }

  /** The offerable mods for a session right now (installed, granted, declares offers, not muted). */
  offerable(hsid: string): DeskMod[] {
    const s = this.#sessions.get(hsid);
    if (s?.stopped) return [];
    const repo = this.#o.repoScopeOf(hsid);
    return this.#o.mods().filter((m) => (m.manifest.provides?.offers?.length ?? 0) > 0 && (m.manifest.provides?.mcp?.length ?? 0) > 0 && !s?.muted.has(m.name) && !this.repoMuted(repo, m.name));
  }

  /** The `<gnomon-desk>` note for a session, or null (composeGuidance joins it with the voice note). */
  guidanceFor(hsid: string): string | null {
    return deskGuidance(this.offerable(hsid).map((m) => ({ name: m.name, offers: (m.manifest.provides?.offers ?? []).map((o) => ({ kind: o.kind, phase: o.phase, title: o.title })) })));
  }

  /** One committed row → the kernel rows to append (offer.shown / offer.kept), possibly none. */
  observe(e: CommittedRow): RouterRow[] {
    if (!OFFER_ROUTER_KINDS.includes(e.kind)) return [];
    const p = isObj(e.payload) ? e.payload : {};
    const hsid = typeof e.session === 'string' ? e.session : typeof p.hsid === 'string' ? p.hsid : null;
    switch (e.kind) {
      case 'request.offer.mute': {
        if (!this.#kernel(e) || validateKindPayload('request.offer.mute', p).length) return [];
        const repo = p.repo as string;
        const set = this.#repoMutes.get(repo) ?? new Set<string>();
        if (p.muted === true) set.add(p.mod as string);
        else set.delete(p.mod as string);
        if (set.size) this.#repoMutes.set(repo, set);
        else this.#repoMutes.delete(repo);
        return [];
      }
      case 'offer.shown': {
        if (!this.#kernel(e) || validateKindPayload('offer.shown', p).length) return [];
        if (this.#offers.size >= MAX_OFFERS) this.#offers.delete(this.#offers.keys().next().value!);
        const id = p.offerId as string;
        this.#offers.set(id, { offerId: id, hsid: p.hsid as string, mod: p.mod as string, kind: p.kind as string, decided: null, kept: false, watchTool: null });
        this.#s(p.hsid as string).latest = id;
        return [];
      }
      case 'offer.decided': {
        if (!this.#kernel(e) || validateKindPayload('offer.decided', p).length) return [];
        const o = this.#offers.get(p.offerId as string);
        const s = this.#s(p.hsid as string);
        const d = p.decision as OfferDecision;
        if (o) {
          o.decided = d;
          if (d === 'open') o.watchTool = this.#handoffOf(o);
        }
        if (d === 'not-now' && o) s.muted.add(o.mod);
        if (d === 'stop-here') s.stopped = true;
        return [];
      }
      case 'offer.kept': {
        const o = this.#offers.get(p.offerId as string);
        if (o && this.#kernel(e)) o.kept = true;
        return [];
      }
      case 'session.exited':
        if (hsid) this.#sessions.delete(hsid);
        return [];
    }
    if (!hsid) return [];
    const s = this.#s(hsid);
    if (e.kind === 'turn.sent') {
      if (typeof p.turn === 'string') s.turns.push(p.turn);
      return [];
    }
    if (e.kind === 'turn.event') {
      if (typeof p.line !== 'string') return [];
      const text = assistantText(p.line);
      if (text !== null && s.texts.reduce((n, t) => n + t.length, 0) + text.length <= MAX_TURN_TEXT) s.texts.push(text);
      return this.#kept(hsid, s, p.line);
    }
    // turn.result: the turn that ended is the oldest outstanding one (FIFO, as the supervisor releases permits)
    const replyTurnId = s.turns.shift() ?? null;
    const reply = s.texts.join('\n\n');
    s.texts = [];
    if (replyTurnId === null) return [];
    const row = this.#offerFor(hsid, s, reply, replyTurnId);
    return row ? [row] : [];
  }

  /** The handoff tool's full names on the mod's OWN servers (serverNameOf, the one naming helper). */
  #handoffOf(o: OfferState): string[] | null {
    const spec = this.#specOf(o.mod, o.kind);
    const entries = this.#o.mods().find((x) => x.name === o.mod)?.manifest.provides?.mcp ?? [];
    return spec ? entries.map((e) => `mcp__${serverNameOf(o.mod, e)}__${spec.handoffTool}`) : null;
  }

  #specOf(mod: string, kind: string): OfferSpecV1 | null {
    const m = this.#o.mods().find((x) => x.name === mod);
    return m?.manifest.provides?.offers?.find((o) => o.kind === kind) ?? null;
  }

  #kept(hsid: string, s: SessionState, line: string): RouterRow[] {
    const watching = [...this.#offers.values()].filter((o) => o.hsid === hsid && o.decided === 'open' && !o.kept && o.watchTool);
    if (!watching.length) return [];
    const ev = parseStreamLine(line);
    if (ev.kind === 'message') {
      for (const t of ev.toolUses) {
        const o = watching.find((w) => w.watchTool!.includes(t.name));
        if (o && t.id !== null && s.calls.size < 256) s.calls.set(t.id, o.offerId);
      }
      return [];
    }
    if (ev.kind !== 'user') return [];
    const out: RouterRow[] = [];
    for (const r of ev.toolResults) {
      const id = s.calls.get(r.toolUseId);
      if (!id) continue;
      s.calls.delete(r.toolUseId);
      const o = this.#offers.get(id);
      if (!o || o.kept || r.isError || r.decision === 'deny') continue;
      o.kept = true; // once per offer, even before the row commits
      const spec = this.#specOf(o.mod, o.kind);
      if (!spec) continue;
      const payload = { offerId: o.offerId, hsid, mod: o.mod, tool: spec.handoffTool };
      if (validateKindPayload('offer.kept', payload).length) continue;
      out.push({ kind: 'offer.kept', payload, session: hsid });
    }
    return out;
  }

  #offerFor(hsid: string, s: SessionState, reply: string, replyTurnId: string): RouterRow | null {
    if (!reply) return null;
    const block = offerBlockOf(reply);
    if (!block) return null;
    if (s.turns.length > 0) return null; // another turn is still streaming
    if (this.#o.pendingCard(hsid)) return null;
    const { mod, kind, question } = block.offer;
    if (!this.offerable(hsid).some((m) => m.name === mod)) return null; // uninstalled, ungranted, paused or muted
    const spec = this.#specOf(mod, kind);
    if (!spec) return null; // not one of that mod's declared offers
    const payload = {
      offerId: this.#o.mintOfferId?.() ?? mintId('offer'),
      hsid,
      mod,
      kind,
      phase: spec.phase,
      title: spec.title,
      contextIn: [...spec.contextIn],
      question,
      replyTurnId,
    };
    if (validateKindPayload('offer.shown', payload).length) return null;
    return { kind: 'offer.shown', payload, session: hsid };
  }

  /** ^offer-accept: request.offer.decide from the human (the dispatcher admits gui/device human connections only). */
  async decide(asker: OfferAsker, payload: unknown): Promise<{ offerId: string; decision: OfferDecision; turn?: unknown }> {
    if (asker.principalClass !== 'human' || (asker.credential !== 'gui' && asker.credential !== 'device') || !asker.principal) {
      throw new RpcRefusal('FORBIDDEN', 'human-only', 'request.offer.decide is the human\'s, on a gui or device connection');
    }
    const errs = validateKindPayload('request.offer.decide', payload);
    if (errs.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `request.offer.decide: ${errs.slice(0, 3).join('; ')}`);
    const p = payload as { offerId: string; decision: OfferDecision };
    const o = this.#offers.get(p.offerId);
    if (!o) throw new RpcRefusal('NOT_FOUND', 'not-found', 'no such offer');
    if (o.decided !== null || this.#deciding.has(o.offerId)) throw new RpcRefusal('BAD_REQUEST', 'replay', 'this offer was already decided', { offerId: o.offerId });
    const owner = this.#o.ownerOf(o.hsid);
    if (owner === undefined) throw new RpcRefusal('NOT_FOUND', 'not-found', 'the offer\'s session is not running', { offerId: o.offerId });
    if (owner !== asker.principal) throw new RpcRefusal('FORBIDDEN', 'not-owner', 'the offer belongs to another human\'s session', { offerId: o.offerId });
    if (this.#sessions.get(o.hsid)?.latest !== o.offerId) throw new RpcRefusal('BAD_REQUEST', 'superseded', 'a newer offer was shown in this session', { offerId: o.offerId });
    const spec = this.#specOf(o.mod, o.kind);
    if (p.decision === 'open' && !spec) throw new RpcRefusal('NOT_FOUND', 'not-found', `${o.mod} no longer offers ${o.kind}`, { offerId: o.offerId });
    this.#deciding.add(o.offerId);
    try {
      await this.#o.append('request.offer.decide', { offerId: o.offerId, decision: p.decision }, { session: o.hsid, connId: asker.connId });
      await this.#o.append('offer.decided', { offerId: o.offerId, hsid: o.hsid, decision: p.decision }, { session: o.hsid, connId: asker.connId });
      // the row's fold may run on commit; set it here too so the decision is final before any await below
      this.observe({ kind: 'offer.decided', principal: this.#o.kernelPrincipal, session: o.hsid, payload: { offerId: o.offerId, hsid: o.hsid, decision: p.decision } });
    } finally {
      this.#deciding.delete(o.offerId);
    }
    if (p.decision !== 'open') return { offerId: o.offerId, decision: p.decision };
    const turn = await this.#o.send(owner, o.hsid, openText(spec!.title, spec!.handoffTool));
    return { offerId: o.offerId, decision: p.decision, turn };
  }

  /** request.offer.mute from the human (gui/device): the kernel writes the request row; the fold applies it. */
  async mute(asker: OfferAsker, payload: unknown): Promise<{ mod: string; repo: string; muted: boolean }> {
    if (asker.principalClass !== 'human' || (asker.credential !== 'gui' && asker.credential !== 'device') || !asker.principal) {
      throw new RpcRefusal('FORBIDDEN', 'human-only', 'request.offer.mute is the human\'s, on a gui or device connection');
    }
    const errs = validateKindPayload('request.offer.mute', payload);
    if (errs.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `request.offer.mute: ${errs.slice(0, 3).join('; ')}`);
    const p = payload as { mod: string; scope: 'repo'; repo: string; muted: boolean };
    const row = { mod: p.mod, scope: p.scope, repo: p.repo, muted: p.muted };
    await this.#o.append('request.offer.mute', row, { connId: asker.connId });
    this.observe({ kind: 'request.offer.mute', principal: this.#o.kernelPrincipal, payload: row });
    return { mod: p.mod, repo: p.repo, muted: p.muted };
  }
}
