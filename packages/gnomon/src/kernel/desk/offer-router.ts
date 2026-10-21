/**
 * @symbol #offer-router
 * @symbol $offer-handoff
 * @symbol ^offer-accept
 *
 * The Desk's offer router (TD-2026-10-20-812, slice S1): a fold over committed log rows (a log.onCommit observer, like
 * the speakable projector) plus the two human requests.
 *
 * $offer-handoff:
 *   1. A reply ends: the MAIN-CHAIN assistant message stops with stop_reason end_turn (the stream_event message_delta,
 *      or an assistant line carrying stop_reason; parent_tool_use_id null). T-2026-10-21-006: this is the moment, not
 *      turn.result, which Claude Code can emit ~30 s later, after the human already sent the next turn. A tool_use
 *      stop never evaluates; a sub-agent's message (parent_tool_use_id set) is never the reply. turn.result is the
 *      fallback only for a turn whose end was not seen (no partial messages, max_tokens). The text of the FINAL
 *      assistant message of the turn (its text blocks, joined by a blank line) is parsed with offerBlockOf (S0, the
 *      one parser shared with the GUI). No block, two blocks, or a malformed block ⇒ nothing (the reply is plain text).
 *   2. BUDGET: at most one per reply (each turn is evaluated exactly once: at its end, or at turn.result if its end
 *      was not seen); none while another turn sent BEFORE this reply ended is outstanding (a turn sent after the reply
 *      ended does not suppress it); none while the session has a pending approval card.
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
 *      mod's own server (`mcp__<mcpServerName(id)>__<handoffTool>`), completes without error in the same hsid. Once per offer.
 *
 * SUPPRESSIONS (founder ruling, T-2026-10-21-006): every evaluation that shows nothing returns one KERNEL row
 * offer.suppressed{hsid, turn, why, name?, offerKind?} (why ∈ OFFER_SUPPRESS_REASONS; name = the block's mod id and
 * offerKind its kind, exactly when the block named them), appended to the signed log like offer.shown. Ids and names
 * only, never message text. At most one per completed main-chain turn (each turn is evaluated once); no-block is
 * written only while the session has an offerable mod (a session with no Desk mod writes nothing).
 *
 * MUTES: offer.decided{not-now} quiets that mod for the rest of the hsid (L4); {stop-here} quiets every mod for the
 * hsid; request.offer.mute{mod, scope:'repo', hsid, muted} (A3; S0b: the human names a LIVE session they own, the
 * kernel derives its repo scope and writes offer.muted{mod, repo, muted, hsid}); offer.muted is folded per repo and
 * survives restarts (seed()). Every mod key is the mod id <publisher>.<name>. Unmuting from Settings with no live
 * session is deferred.
 * A mute (and a mod pause) stops offers at once and refuses offer.kept, but the mod's MCP server stays in a running
 * session's mcp.json: removing it applies to new sessions.
 */

import {
  mintId,
  offerBlockOf,
  validateKindPayload,
  type OfferDecision,
  type OfferSuppressReason,
  type OfferSpecV1,
} from '@a-company/gnomon-contracts';
import { parseStreamLine } from '../../adapters/claude-code/adapter.js';
import { RpcRefusal } from '../socket/rpc.js';
import { deskGuidance } from './desk-guidance.js';
import { serverNameOf, type DeskMod } from './mcp-passthrough.js';

/** The rows the router folds. */
export const OFFER_ROUTER_KINDS: readonly string[] = Object.freeze([
  'turn.sent', 'turn.event', 'turn.result', 'session.exited',
  'offer.shown', 'offer.decided', 'offer.kept', 'offer.muted',
]);
/** The rows seed() reads at boot (the persistent state: repo mutes and the offers of resumed sessions). */
export const OFFER_SEED_KINDS: readonly string[] = Object.freeze(['offer.shown', 'offer.decided', 'offer.kept', 'offer.muted']);

/** The kernel template of an `open` turn (manifest fields only; the tool fully qualified, mcp__<server>__<tool>, H1c). */
export function openText(title: string, qualifiedTool: string): string {
  return `Open ${title}: use the ${qualifiedTool} tool.`;
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
  /**
   * Aegis S1 H1b: the desk servers mergeDeskMcp actually ADDED to this session's mcp.json at spawn (undefined = none).
   * A mod is offered, and kept is counted, only through a server in this set (needs-config, muted-at-spawn and
   * name-taken mods never are).
   */
  sessionServers: (hsid: string) => ReadonlySet<string> | undefined;
  /** kernel diagnostics (the daemon's daemon.desk diag channel): kept.refused, send.failed */
  diag?: (event: string, data: Record<string, unknown>) => void;
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
  /** the session exited; its mutes stay until the state is evicted (L7) */
  exited: boolean;
  /** outstanding turn ids, oldest first (turn.result closes the head) */
  turns: string[];
  /** the text blocks of the current main-chain assistant message */
  texts: string[];
  /** that message's id (a new id starts a new message) */
  msgId: string | null;
  /** the turn id already evaluated (at its end), so turn.result never evaluates it again */
  evaluated: string | null;
  muted: Set<string>;
  stopped: boolean;
  latest: string | null;
  /** tool_use id → offerId, for kept */
  calls: Map<string, string>;
}


function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** What one MAIN-CHAIN stream line means to the router (sub-agent lines, parent_tool_use_id set, are ignored). */
interface ChainLine {
  /** message_start or an assistant line: the message id it belongs to */
  msgId: string | null;
  /** message_start: a new message begins */
  start: boolean;
  /** an assistant line's text blocks, joined by a blank line */
  text: string | null;
  /** the message's stop_reason, when this line carries it (message_delta, or an assistant line) */
  stop: string | null;
}

function chainLine(line: string): ChainLine | null {
  let o: unknown;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObj(o) || (o.parent_tool_use_id !== undefined && o.parent_tool_use_id !== null)) return null;
  if (o.type === 'assistant') {
    const m = isObj(o.message) ? o.message : {};
    const content = Array.isArray(m.content) ? (m.content as unknown[]) : [];
    const t = content.filter((b) => isObj(b) && b.type === 'text' && typeof b.text === 'string').map((b) => (b as { text: string }).text);
    return { msgId: typeof m.id === 'string' ? m.id : null, start: false, text: t.length ? t.join('\n\n') : null, stop: typeof m.stop_reason === 'string' ? m.stop_reason : null };
  }
  if (o.type !== 'stream_event' || !isObj(o.event)) return null;
  const ev = o.event;
  if (ev.type === 'message_start') {
    const m = isObj(ev.message) ? ev.message : {};
    return { msgId: typeof m.id === 'string' ? m.id : null, start: true, text: null, stop: null };
  }
  if (ev.type === 'message_delta' && isObj(ev.delta) && typeof ev.delta.stop_reason === 'string') {
    return { msgId: null, start: false, text: null, stop: ev.delta.stop_reason };
  }
  return null;
}

/** A model reply holding an ```offer fence line that offerBlockOf refused (vs no block at all). */
function hasOfferFence(reply: string): boolean {
  return reply.split('\n').some((l) => l.replace(/[ \t\r]+$/, '') === '```offer');
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
      s = { exited: false, turns: [], texts: [], msgId: null, evaluated: null, muted: new Set(), stopped: false, latest: null, calls: new Map() };
      this.#sessions.set(hsid, s);
    } else {
      // LRU: a touched session moves to the back of the eviction order
      this.#sessions.delete(hsid);
      this.#sessions.set(hsid, s);
    }
    return s;
  }

  /** Aegis S1 L4: only the kernel principal's rows are folded. */
  #kernel(e: CommittedRow): boolean {
    return e.principal === this.#o.kernelPrincipal;
  }

  /** The mod's servers added to THIS session (H1b), as names from serverNameOf. */
  #servedNames(hsid: string, mod: DeskMod): string[] {
    const set = this.#o.sessionServers(hsid);
    if (!set) return [];
    return mod.manifest.provides?.mcp?.length ? [serverNameOf(mod.name)].filter((n) => set.has(n)) : [];
  }

  /** Muted for the hsid (not-now / stop-here) or its repo. */
  #muted(hsid: string, mod: string): boolean {
    const s = this.#sessions.get(hsid);
    return s?.stopped === true || s?.muted.has(mod) === true || this.repoMuted(this.#o.repoScopeOf(hsid), mod);
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
    return this.#o.mods().filter((m) => (m.manifest.provides?.offers?.length ?? 0) > 0 && this.#servedNames(hsid, m).length > 0 && !s?.muted.has(m.name) && !this.repoMuted(repo, m.name));
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
      case 'offer.muted': {
        if (!this.#kernel(e) || validateKindPayload('offer.muted', p).length) return [];
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
          if (d === 'open') o.watchTool = this.#handoffOf(o.hsid, o);
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
        // L7: mutes and stop-here stay until the state is evicted (bounded LRU), not dropped at exit
        if (hsid && this.#sessions.has(hsid)) this.#s(hsid).exited = true;
        return [];
    }
    if (!hsid) return [];
    const s = this.#s(hsid);
    if (e.kind === 'turn.sent') {
      if (typeof p.turn === 'string') s.turns.push(p.turn);
      s.latest = null; // L1: a new turn retires the shown offer (the kernel is as strict as the GUI)
      return [];
    }
    if (e.kind === 'turn.event') {
      if (typeof p.line !== 'string') return [];
      const out = this.#kept(hsid, s, p.line);
      const c = chainLine(p.line);
      if (!c) return out;
      if (c.start || (c.msgId !== null && c.msgId !== s.msgId)) {
        // a new main-chain message: only the FINAL message of the turn is the reply
        s.texts = [];
        s.msgId = c.msgId;
      }
      if (c.text !== null && s.texts.reduce((n, t) => n + t.length, 0) + c.text.length <= MAX_TURN_TEXT) s.texts.push(c.text);
      // T-2026-10-21-006: the reply ended (end_turn, not tool_use) ⇒ evaluate now, once, for the oldest outstanding turn
      const head = s.turns[0];
      if (c.stop === 'end_turn' && head !== undefined && s.evaluated !== head) {
        s.evaluated = head;
        const row = this.#offerFor(hsid, s.texts.join('\n\n'), head, s.turns.length - 1);
        if (row) out.push(row);
      }
      return out;
    }
    // turn.result{turn} (review M2) names the latest turn it closes: every outstanding turn up to it closes (a queued
    // message folded into the running turn); a row without it (older logs) closes the oldest one (FIFO)
    const at = typeof p.turn === 'string' ? s.turns.indexOf(p.turn) : -1;
    const closed = s.turns.splice(0, at >= 0 ? at + 1 : Math.min(1, s.turns.length));
    const replyTurnId = closed[closed.length - 1] ?? null;
    const reply = s.texts.join('\n\n');
    const done = replyTurnId !== null && closed.some((t) => s.evaluated === t);
    s.texts = [];
    s.msgId = null;
    s.evaluated = null;
    if (replyTurnId === null || done) return [];
    // fallback: the turn's end was not seen (no message_delta end_turn); evaluated here, with today's streaming rule
    const row = this.#offerFor(hsid, reply, replyTurnId, s.turns.length);
    return row ? [row] : [];
  }

  /** The handoff tool's full names on the mod's OWN servers added to THIS session (serverNameOf; H1b). */
  #handoffOf(hsid: string, o: { mod: string; kind: string }): string[] | null {
    const spec = this.#specOf(o.mod, o.kind);
    const mod = this.#o.mods().find((x) => x.name === o.mod);
    if (!spec || !mod) return null;
    const names = this.#servedNames(hsid, mod).map((n) => `mcp__${n}__${spec.handoffTool}`);
    return names.length ? names : null;
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
      const spec = this.#specOf(o.mod, o.kind);
      // M3: a mod paused, uninstalled or muted since the open never counts as kept (its server may still run until a new session)
      if (!spec || this.#muted(hsid, o.mod)) {
        this.#o.diag?.('kept.refused', { hsid, offerId: o.offerId, name: o.mod, why: spec ? 'muted' : 'paused-or-uninstalled' });
        continue;
      }
      o.kept = true; // once per offer, even before the row commits
      const payload = { offerId: o.offerId, hsid, mod: o.mod, tool: spec.handoffTool };
      if (validateKindPayload('offer.kept', payload).length) continue;
      out.push({ kind: 'offer.kept', payload, session: hsid });
    }
    return out;
  }

  /** Every evaluation that shows nothing says why: the kernel offer.suppressed row (ids and names only, never text). */
  #suppressed(hsid: string, turn: string, why: OfferSuppressReason, named?: { mod: string; kind: string }): RouterRow | null {
    const payload = { hsid, turn, why, ...(named ? { name: named.mod, offerKind: named.kind } : {}) };
    if (validateKindPayload('offer.suppressed', payload).length) return null;
    return { kind: 'offer.suppressed', payload, session: hsid };
  }

  /** `others`: the outstanding turns other than this reply's (sent before the reply ended, or before turn.result on the fallback). */
  #offerFor(hsid: string, reply: string, replyTurnId: string, others: number): RouterRow | null {
    const block = reply ? offerBlockOf(reply) : null;
    if (!block) {
      if (reply && hasOfferFence(reply)) return this.#suppressed(hsid, replyTurnId, 'malformed');
      // volume: a plain reply in a session with nothing to offer is not a suppression (the roster note was not sent)
      return this.offerable(hsid).length ? this.#suppressed(hsid, replyTurnId, 'no-block') : null;
    }
    const { mod, kind, question } = block.offer;
    const named = { mod, kind };
    if (others > 0) return this.#suppressed(hsid, replyTurnId, 'turn-streaming', named); // another turn is still streaming
    if (this.#o.pendingCard(hsid)) return this.#suppressed(hsid, replyTurnId, 'pending-card', named);
    // uninstalled, ungranted, paused or muted
    if (!this.offerable(hsid).some((m) => m.name === mod)) return this.#suppressed(hsid, replyTurnId, 'not-offerable', named);
    const spec = this.#specOf(mod, kind);
    if (!spec) return this.#suppressed(hsid, replyTurnId, 'kind-undeclared', named); // not one of that mod's declared offers
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
    if (validateKindPayload('offer.shown', payload).length) return this.#suppressed(hsid, replyTurnId, 'malformed', named);
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
    const tools = this.#handoffOf(o.hsid, o);
    if (p.decision === 'open' && (!spec || !tools)) throw new RpcRefusal('NOT_FOUND', 'not-found', `${o.mod} no longer offers ${o.kind} in this session`, { offerId: o.offerId });
    this.#deciding.add(o.offerId);
    try {
      await this.#o.append('request.offer.decide', { offerId: o.offerId, decision: p.decision }, { session: o.hsid, connId: asker.connId });
      // L5: decided once the request row commits, so a retry is a replay and never writes a second request row
      o.decided = p.decision;
      await this.#o.append('offer.decided', { offerId: o.offerId, hsid: o.hsid, decision: p.decision }, { session: o.hsid, connId: asker.connId });
      this.observe({ kind: 'offer.decided', principal: this.#o.kernelPrincipal, session: o.hsid, payload: { offerId: o.offerId, hsid: o.hsid, decision: p.decision } });
    } finally {
      this.#deciding.delete(o.offerId);
    }
    if (p.decision !== 'open') return { offerId: o.offerId, decision: p.decision };
    try {
      const turn = await this.#o.send(owner, o.hsid, openText(spec!.title, tools![0]!));
      return { offerId: o.offerId, decision: p.decision, turn };
    } catch (err) {
      this.#o.diag?.('send.failed', { hsid: o.hsid, offerId: o.offerId, name: o.mod, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
      throw err;
    }
  }

  /**
   * request.offer.mute from the human (gui/device), S0b: the human names a LIVE session they own; the kernel derives the
   * repo scope from it (never trusting a client repo key), writes the request row and the kernel-owned offer.muted, and
   * the fold applies offer.muted.
   */
  async mute(asker: OfferAsker, payload: unknown): Promise<{ mod: string; repo: string; muted: boolean }> {
    if (asker.principalClass !== 'human' || (asker.credential !== 'gui' && asker.credential !== 'device') || !asker.principal) {
      throw new RpcRefusal('FORBIDDEN', 'human-only', 'request.offer.mute is the human\'s, on a gui or device connection');
    }
    const errs = validateKindPayload('request.offer.mute', payload);
    if (errs.length) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `request.offer.mute: ${errs.slice(0, 3).join('; ')}`);
    const p = payload as { mod: string; scope: 'repo'; hsid: string; muted: boolean };
    const owner = this.#o.ownerOf(p.hsid);
    if (owner === undefined) throw new RpcRefusal('NOT_FOUND', 'not-found', 'the session is not running (unmuting with no live session is not supported yet)');
    if (owner !== asker.principal) throw new RpcRefusal('FORBIDDEN', 'not-owner', 'the session belongs to another human');
    const repo = this.#o.repoScopeOf(p.hsid);
    if (repo === null) throw new RpcRefusal('NOT_FOUND', 'not-found', 'the session has no repo scope');
    await this.#o.append('request.offer.mute', { mod: p.mod, scope: p.scope, hsid: p.hsid, muted: p.muted }, { session: p.hsid, connId: asker.connId });
    const row = { mod: p.mod, repo, muted: p.muted, hsid: p.hsid };
    await this.#o.append('offer.muted', row, { session: p.hsid, connId: asker.connId });
    this.observe({ kind: 'offer.muted', principal: this.#o.kernelPrincipal, payload: row });
    return { mod: p.mod, repo, muted: p.muted };
  }
}
