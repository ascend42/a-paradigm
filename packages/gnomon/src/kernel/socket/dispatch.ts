/**
 * @symbol #socket
 *
 * #socket verb dispatch (spec §4.9, §5; M1.4 slice 1).
 *
 * Per connection: `{connId, phase, principal, surface, …}` (auth.ts). Before
 * auth a caller may send only `hello` and `auth`; a known verb is refused
 * `AUTH{reason:'unauthenticated'}` (connection kept), an unknown name is
 * `UNKNOWN_VERB`. A failed `auth` is answered with ONE AUTH refusal and the
 * connection is closed. After auth, every one of the 12 verbs + 2 relays is
 * checked against the §5 verb × principal matrix (contracts `VERBS.access`;
 * the peer column is refused everywhere) and then either served — `status`,
 * for real — or refused `ENGINE{reason:'not-implemented', verb, milestone}`:
 * no fake success. The surface is exactly the contracts' CLIENT_METHODS; no
 * verb exists to serve a client (M1.4 falsifier).
 *
 * Access qualifiers: only the plain `'yes'` of the matrix is served by the
 * generic rule; any other qualified value (`'own view'`, …) needs a scoped
 * view that does not exist yet and is refused ENGINE{not-implemented} naming
 * its milestone — never the full view. M1.4 SLICE 2: `log.read` and
 * `ref.resolve` are handled EXPLICITLY per reader class (log-read.ts
 * readerFor: human → community-client projection until first-party proof,
 * mod → own modns, agent/voice → UNSUPPORTED, session → not-implemented
 * M1.7), pages and `follow` subscriptions via log-read.ts, refs via
 * #ref-resolver (refs/resolve.ts). Without a `reads` source (unit rigs) both
 * stay ENGINE not-implemented.
 *
 * Log-before-reply (chain write before side effect, §2.4 rule 4):
 * socket.hello and socket.auth.ok are written BEFORE the reply; if either
 * write fails the request is refused ENGINE{log-write-failed} and the
 * connection is closed (never authenticated without its row, never wedged).
 * socket.auth.fail / socket.auth.replay rows are BEST-EFFORT: written before
 * the refusal when the log accepts them, but a log failure never turns a
 * refusal into anything else. The `log` callback may RATE-LIMIT socket.hello
 * and socket.auth.fail (daemon.ts folds all but the first 8 per window into a
 * signed counter row); "written before the reply" then means the row or its
 * counter increment.
 *
 * M1.4 SLICE 3: a known verb before auth is AUTH{unauthenticated} AND closes
 * the connection (G-SOCK-01; counted as 'unauthenticated-call' in the
 * coalesced pre-auth row). Read-token connections (auth.ts) have matrix class
 * `readToken`: status, log.read, ref.resolve only; every other verb and both
 * relays are FORBIDDEN{matrix}. Their token is re-checked on every call and by
 * a per-connection timer (expiry, revocation every `tokenRecheckMs`); a dead
 * token closes the connection after AUTH{token-expired|token-revoked} and a
 * best-effort socket.disconnect{reason, tokenId} row. `log.append` is the
 * namespace-ownership gate (log-append.ts, G-SOCK-04): every cell refuses in
 * M1.4. status lists only next verbs the caller's class may call.
 *
 * M1.4 #web-endpoint: the web endpoint runs its OWN dispatcher (its
 * authenticator signs the ws:// endpoint path) with a `web` hook that serves
 * `auth {launchToken}` / `{reconnect}` (web/endpoint.ts). A GUI connection is
 * matrix class `human`; its auth.ok row is followed by socket.gui.token.issued
 * and both are written before the `{guiToken, principal, connId}` reply (the
 * session is withdrawn if either write fails). An auth refusal may carry rows
 * to write first (socket.auth.reconnect.requested) and its own row kind
 * (socket.auth.theft).
 *
 * Pre-auth limits (Aegis round 2): a connection with no hello after
 * `helloTimeoutMs` (10 s) or not authenticated after `preAuthTimeoutMs` (the
 * 30 s nonce TTL) is closed; at most `maxPreAuth` (64) unauthenticated
 * connections exist at once — the next one is closed on connect. Closures are
 * counted for the coalesced diagnostic row (daemon.ts), not logged one by one.
 *
 * M1.6 #approval-broker + #budget-fuse: `approve` and `permit.reserve` are
 * handled EXPLICITLY (T-2026-10-17-017), never by the generic qualified-
 * access rule: `approve` from the voice principal is FORBIDDEN gate voice
 * `voice-off` in every form (no arm can exist before Move 4, G-ABI-02 voice
 * row); from the human it goes to the broker, which applies the presence
 * class of §3.4 ("presence per class; root key for use-api-token, install;
 * withdraw on held cards"). `permit.reserve` for the human and agent classes
 * goes to the fuse; the session class ("own scope") needs session principals
 * (M1.7). Without an `approvals` port (unit rigs) both stay not-implemented.
 * A closed connection drops its cached unlock.
 *
 * M1.7 #supervisor (slice 1): `session.open`, `session.send` and
 * `session.stop` from a HUMAN principal go to the session port (attended,
 * human-started Claude Code sessions only); every other class keeps the
 * matrix's answer (not-implemented until session principals land).
 */
import {
  CLIENT_API_ID,
  CLIENT_RELAYS,
  KIT_ID,
  RELAY_NAMES,
  VERB_NAMES,
  VERBS,
  canonicalJson,
  hex,
  sha256,
  type Access,
  type PrincipalKind,
  type VerbDescriptor,
} from '@a-company/gnomon-contracts';
import type { ConnectionContext, RpcHandler } from './server.js';
import { RpcRefusal, type RpcRequestFrame } from './rpc.js';
import type { ConnAuthState, SocketAuthenticator, WebAuthHook } from './auth.js';
import { resolveRef } from '../refs/resolve.js';
import { refuseAppend, type AppendClass } from './log-append.js';
import type { SessionPort } from '../supervisor/port.js';

const SESSION_METHODS: readonly string[] = ['session.open', 'session.send', 'session.stop'];
import { voiceApproveRefusal } from '../broker/broker.js';
import type { ApprovalPort } from '../broker/port.js';
import { asRpcRefusal, parseLogReadParams, readerFor, readOnePage, SUBSCRIPTION_BACKLOG_CAP, MAX_SUBSCRIPTIONS_PER_CONNECTION, type ReadLog, type SubscriptionHub } from './log-read.js';

/** Where each not-yet-served method lands (spec §19). */
export const VERB_MILESTONES: Readonly<Record<string, string>> = Object.freeze({
  status: 'M1.4',
  'session.open': 'M1.7',
  'session.send': 'M1.7',
  'session.stop': 'M1.7',
  // The ownership gate is served since M1.4 slice 3 (every cell refuses). The first
  // cell that can succeed is a grant.bind'd kind: grant.bind{principal, manifestHash,
  // kinds[]} needs root-signed grants (M1.3) AND a loaded manifest (#manifest-loader M1.5).
  'log.append': 'M1.5',
  'log.read': 'M1.4',
  'permit.reserve': 'M1.6',
  approve: 'M1.6',
  // (the session class's permit.reserve, "own scope", lands with session principals in M1.7)
  'contract.register': 'M2.1',
  'contract.claim': 'M2.2',
  'oracle.run': 'M2.3',
  'ref.resolve': 'M1.4',
  'mod.view': 'M1.11',
  'mod.command': 'M1.11',
});

export const SERVED_METHODS: readonly string[] = Object.freeze(['status', 'log.read', 'ref.resolve']);
/** Served only when the dispatcher has a log to read (the daemon always passes one). */
const READ_METHODS: readonly string[] = Object.freeze(['log.read', 'ref.resolve']);

/**
 * §5 next-legal-verbs table, verbatim order. `when` = every listed fact holds.
 * Hashed into abiId with the verb and relay descriptors.
 */
export const NEXT_LEGAL_TABLE: ReadonlyArray<{ when: readonly string[]; verbs: readonly string[] }> = Object.freeze([
  { when: ['budgetPaused'], verbs: ['status', 'log.read'] },
  { when: ['cardsPendingForYou>0', 'human'], verbs: ['approve'] },
  { when: ['human', 'heldCards>0'], verbs: ['approve decision:withdraw'] },
  { when: ['voice', 'armed', 'voiceEligibleCards>0'], verbs: ['approve'] },
  { when: ['voice', '!armed'], verbs: ['status', 'log.read', 'session.send', 'session.stop'] },
  { when: ['repoStrictness:L3', 'agent|session'], verbs: ['status', 'log.read'] },
  { when: ['reviewReturned'], verbs: ['contract.claim op:built'] },
  { when: ['reviewCapped', 'agent|session'], verbs: ['status', 'log.read'] },
  { when: ['noSession'], verbs: ['session.open'] },
  { when: ['noPermit'], verbs: ['permit.reserve'] },
  { when: ['hasContract', 'unclaimed>0'], verbs: ['contract.claim'] },
  { when: ['claimed', 'built:false'], verbs: ['contract.claim op:built'] },
  { when: ['built'], verbs: ['oracle.run'] },
  { when: [], verbs: ['status'] },
]);

/** abiId = sha256(canonical {verbs, relays, nextLegal}) — the descriptors.ts:383-393 pattern. */
export const ABI_ID: string = `sha256:${hex(sha256(canonicalJson({ verbs: VERBS, relays: CLIENT_RELAYS, nextLegal: NEXT_LEGAL_TABLE })))}`;

type MatrixClass = keyof VerbDescriptor['access'];

export function matrixClass(kind: PrincipalKind): MatrixClass {
  switch (kind) {
    case 'human':
    case 'agent':
    case 'session':
    case 'mod':
    case 'voice':
      return kind;
    default:
      return 'peer'; // kernel and peer are never socket clients: refused everywhere
  }
}

/** The matrix column of an authenticated connection: a read token is `readToken` whatever its principal (§5). */
export function matrixClassOf(s: Pick<ConnAuthState, 'credential' | 'principalKind'>): MatrixClass {
  if (s.credential === 'read-token') return 'readToken';
  return s.principalKind ? matrixClass(s.principalKind) : 'peer';
}

/** Access of a method (verb or relay) for a class; relays are `caller principal` except for peers and read tokens (§5). */
export function accessOf(method: string, cls: MatrixClass): Access {
  const verb = VERBS.find((v) => v.verb === method);
  if (verb) return verb.access[cls];
  return cls === 'peer' || cls === 'readToken' ? false : 'caller principal';
}

export function nextLegalVerbs(facts: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const row of NEXT_LEGAL_TABLE) {
    if (row.when.every((f) => facts.has(f))) for (const v of row.verbs) if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** What the daemon contributes to `status` (kept cheap: G-ABI-03 < 50 ms). */
export interface KernelStatusSource {
  daemon(): Record<string, unknown>;
  log(): Record<string, unknown>;
  kernelKey(): { keyId: string; custody: 'full' | 'partial'; source: string };
  root(): { state: string; rootKeyId: string | null };
  /** The web endpoint's status block (#web-endpoint; absent ⇒ `{listening:false}`). */
  web?(): Record<string, unknown>;
}

export type SocketLogKind =
  | 'socket.hello'
  | 'socket.auth.ok'
  | 'socket.auth.fail'
  | 'socket.auth.replay'
  | 'socket.auth.theft'
  | 'socket.auth.reconnect.requested'
  | 'socket.gui.token.issued'
  | 'socket.disconnect';

export type PreAuthCloseReason = 'hello-timeout' | 'pre-auth-timeout' | 'pre-auth-cap' | 'unauthenticated-call';

/** How often a live read-token connection's token is re-checked for revocation (expiry has its own timer). */
export const TOKEN_RECHECK_MS = 5_000;

export const HELLO_TIMEOUT_MS = 10_000;
export const PRE_AUTH_TIMEOUT_MS = 30_000;
export const MAX_PRE_AUTH = 64;

/** Milestone for a qualified (scoped) access value, by principal class. */
export const SCOPED_VIEW_MILESTONES: Readonly<Record<string, string>> = Object.freeze({
  mod: 'M1.11',
  agent: 'Move 2',
  session: 'M1.7',
  voice: 'Move 4',
  readToken: 'M1.4',
  human: 'M1.4',
});

export interface DispatcherOptions {
  authenticator: SocketAuthenticator;
  helloTimeoutMs?: number;
  preAuthTimeoutMs?: number;
  maxPreAuth?: number;
  /** A pre-auth connection was closed by a deadline or the cap (for the coalesced counter). */
  onPreAuthClose?: (why: PreAuthCloseReason) => void;
  /** Read-token revocation re-check period (default TOKEN_RECHECK_MS). */
  tokenRecheckMs?: number;
  status: KernelStatusSource;
  /** The kernel log read side + the subscription hub (M1.4 slice 2). Absent ⇒ log.read/ref.resolve stay not-implemented. */
  reads?: { log: ReadLog; hub: SubscriptionHub };
  /** The web endpoint's launch/reconnect auth handler (#web-endpoint dispatcher only). */
  web?: WebAuthHook;
  /** #approval-broker + #budget-fuse (M1.6). Absent ⇒ approve / permit.reserve stay not-implemented. */
  approvals?: ApprovalPort;
  /** #supervisor (M1.7 slice 1): session.open/send/stop for a HUMAN principal. Absent ⇒ they stay not-implemented. */
  sessions?: SessionPort;
  /** Append a socket.* row to the kernel log; must reject if the row was not written. */
  log: (kind: SocketLogKind, payload: Record<string, unknown>, ids: { connId: string; deviceId?: string }) => Promise<void>;
}

export interface KernelDispatcher {
  handle: RpcHandler;
  onConnect(ctx: ConnectionContext): void;
  onDisconnect(ctx: ConnectionContext): void;
  /** Authenticated connections (status `clients`). */
  clients(): ConnAuthState[];
  /** Connections holding timers (tests: nothing outlives its connection). */
  timerCount(): number;
}

export function createKernelDispatcher(o: DispatcherOptions): KernelDispatcher {
  const conns = new Map<string, ConnAuthState>();
  const timers = new Map<string, NodeJS.Timeout[]>();
  const helloMs = o.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  const preAuthMs = o.preAuthTimeoutMs ?? PRE_AUTH_TIMEOUT_MS;
  const maxPreAuth = o.maxPreAuth ?? MAX_PRE_AUTH;
  const clearTimers = (connId: string): void => {
    for (const t of timers.get(connId) ?? []) clearTimeout(t);
    timers.delete(connId);
  };
  const preAuthCount = (): number => [...conns.values()].filter((c) => c.phase !== 'authenticated').length;
  const stateOf = (connId: string): ConnAuthState => {
    let s = conns.get(connId);
    if (!s) {
      s = { connId, phase: 'new' };
      conns.set(connId, s);
    }
    return s;
  };

  const status = (s: ConnAuthState): Record<string, unknown> => {
    const cls = matrixClassOf(s);
    const facts = new Set<string>(['noSession', 'noPermit', cls]);
    if (cls === 'agent' || cls === 'session') facts.add('agent|session');
    if (cls === 'voice') facts.add('!armed');
    const key = o.status.kernelKey();
    const available = (m: string): boolean =>
      (SERVED_METHODS.includes(m) && (o.reads !== undefined || !READ_METHODS.includes(m))) || (o.approvals !== undefined && ((m === 'approve' && cls === 'human') || (m === 'permit.reserve' && (cls === 'human' || cls === 'agent')))) || (o.sessions !== undefined && cls === 'human' && SESSION_METHODS.includes(m));
    return {
      principal: s.principal,
      principalKind: s.principalKind,
      connId: s.connId,
      deviceId: s.deviceId,
      surface: s.client?.surface ?? null,
      clientApi: s.clientApi,
      clientApiId: CLIENT_API_ID,
      kitId: KIT_ID,
      abiId: ABI_ID,
      credential: s.credential ?? 'device',
      ...(s.credential === 'read-token' ? { token: { tokenId: s.tokenId, expiresAt: s.tokenExpiresAt } } : {}),
      nextLegalVerbs: nextLegalVerbs(facts)
        .filter((v) => accessOf(v.split(' ')[0]!, cls) !== false) // legal for THIS class only
        .map((v) => ({ verb: v, available: available(v.split(' ')[0]!) })),
      verbs: VERBS.map((v) => ({ verb: v.verb, access: v.access[cls], available: available(v.verb), milestone: VERB_MILESTONES[v.verb] })),
      relays: CLIENT_RELAYS.map((r) => ({ relay: r.relay, access: accessOf(r.relay, cls), available: false, milestone: VERB_MILESTONES[r.relay] })),
      daemon: o.status.daemon(),
      log: o.status.log(),
      sessions: { n: 0 },
      cards: o.approvals?.cards(cls) ?? { n: 0, pendingForYou: 0 },
      ...(o.approvals ? o.approvals.status() : {}),
      kernelKeyId: key.keyId,
      kernelKeyCustody: key.custody,
      kernelKeySource: key.source,
      root: o.status.root(),
      web: o.status.web?.() ?? { listening: false },
      subscriptions: { n: o.reads?.hub.count() ?? 0, onThisConnection: o.reads?.hub.count(s.connId) ?? 0, perConnectionMax: MAX_SUBSCRIPTIONS_PER_CONNECTION, backlogCap: o.reads?.hub.cap ?? SUBSCRIPTION_BACKLOG_CAP },
      clients: [...conns.values()]
        .filter((c) => c.phase === 'authenticated')
        .map((c) => ({ connId: c.connId, principal: c.principal, surface: c.client?.surface ?? null, client: { name: c.client?.name, version: c.client?.version }, conformance: c.client?.conformance ?? null })),
    };
  };

  const recheckMs = o.tokenRecheckMs ?? TOKEN_RECHECK_MS;
  /** A read-token connection whose token died: log (best-effort), then close. Returns the refusal to answer with. */
  const tokenDead = (s: ConnAuthState, ctx: ConnectionContext, reason: string, closeNow: boolean): RpcRefusal => {
    if (s.phase !== 'closed') {
      s.phase = 'closed';
      clearTimers(s.connId);
      void o.log('socket.disconnect', { reason, tokenId: s.tokenId ?? null }, { connId: s.connId }).catch(() => undefined);
      if (closeNow) ctx.close(); // timer path: no reply to send; the call path closes after its AUTH reply
    }
    return new RpcRefusal('AUTH', reason, 'the read token of this connection is no longer valid', { tokenId: s.tokenId }, { closeAfter: true });
  };
  const liveTokenCheck = (s: ConnAuthState): string | null => {
    const c = o.authenticator.checkToken(s.tokenId!);
    if (!c.ok) return c.reason;
    return null;
  };
  const armTokenTimers = (s: ConnAuthState, ctx: ConnectionContext): void => {
    const sweep = (): void => {
      if (conns.get(s.connId) !== s || s.phase !== 'authenticated') {
        if (conns.get(s.connId) === undefined) clearTimers(s.connId); // stale: never leave a timer behind
        return;
      }
      const dead = liveTokenCheck(s);
      if (dead) tokenDead(s, ctx, dead, true);
    };
    const untilExpiry = Math.max(0, (s.tokenExpiresAtMs ?? 0) - o.authenticator.now());
    timers.set(s.connId, [setTimeout(sweep, Math.min(untilExpiry + 1, 2 ** 31 - 1)).unref(), setInterval(sweep, recheckMs).unref()]);
  };

  const handle: RpcHandler = async (frame: RpcRequestFrame, ctx: ConnectionContext) => {
    // A request queued before the close must not re-create state for a gone connection (zombie pre-auth entries).
    if (ctx.closed) throw new RpcRefusal('ENGINE', 'gone', 'the connection is closed');
    const s = stateOf(ctx.connId);
    const m = frame.method;

    if (m === 'hello') {
      const out = o.authenticator.hello(s, frame.params);
      const client = s.client ?? (isClient(frame.params) ? frame.params.client : undefined);
      try {
        await o.log(
        'socket.hello',
        {
          outcome: out.ok ? 'ok' : String(out.refusal.data?.reason ?? out.refusal.code),
          clientApi: out.ok ? out.result.clientApi : null,
          ...(!out.ok && out.offered ? { offered: out.offered.slice(0, 16).map((a) => String(a).slice(0, 64)) } : {}),
          client: client ? { name: clip(client.name), version: clip(client.version), surface: clip(client.surface) } : null,
        },
        { connId: s.connId },
      );
      } catch {
        s.phase = 'closed'; // never wedged: no reply can claim a hello the log does not hold
        throw new RpcRefusal('ENGINE', 'log-write-failed', 'the kernel log refused the hello row', undefined, { closeAfter: true });
      }
      if (!out.ok) throw RpcRefusal.from(out);
      return out.result;
    }

    if (m === 'auth') {
      const out = o.authenticator.authenticate(s, frame.params, {
        tokenInUse: (tokenId) => [...conns.values()].some((c) => c !== s && c.phase === 'authenticated' && c.tokenId === tokenId),
        ...(o.web ? { web: o.web } : {}),
      });
      if (!out.ok) {
        for (const row of out.preRows ?? []) await o.log(row.kind, row.payload, { connId: s.connId }).catch(() => undefined);
        await o
          .log(
            out.logKind ?? (out.replay ? 'socket.auth.replay' : 'socket.auth.fail'),
            out.logPayload ?? { reason: out.reason, ...(out.principalClaimed ? { principalClaimed: out.principalClaimed } : {}), ...(out.tokenId ? { tokenId: out.tokenId } : {}) },
            {
              connId: s.connId,
              ...(out.deviceId ? { deviceId: out.deviceId } : {}),
            },
          )
          .catch(() => undefined); // the refusal and the close happen regardless
        throw RpcRefusal.from(out, { closeAfter: true });
      }
      try {
        if (out.credential === 'gui') {
          const surface = s.client?.surface ?? null;
          await o.log('socket.auth.ok', { principal: out.principal, principalKind: 'human', credential: 'gui', client: 'gui', via: out.via, surface }, { connId: s.connId, deviceId: out.deviceId });
          await o.log('socket.gui.token.issued', { via: out.via, surface, client: 'gui' }, { connId: s.connId, deviceId: out.deviceId });
        } else if (out.credential === 'device') {
          await o.log('socket.auth.ok', { principal: out.principal, principalKind: out.principalKind, keyId: out.keyId, surface: s.client?.surface ?? null }, { connId: s.connId, deviceId: out.deviceId });
        } else {
          // the token id only — never the token or a digest of it
          await o.log('socket.auth.ok', { principal: out.principal, principalKind: null, credential: 'read-token', tokenId: out.tokenId, expiresAt: out.expiresAt, surface: s.client?.surface ?? null }, { connId: s.connId });
        }
      } catch {
        s.phase = 'closed'; // never authenticated without the row
        if (out.credential === 'gui') out.abort();
        throw new RpcRefusal('ENGINE', 'log-write-failed', 'the kernel log refused the auth row; not authenticated', undefined, { closeAfter: true });
      }
      if (ctx.closed || conns.get(s.connId) !== s || s.phase !== 'authenticated') {
        // the connection went away (or was revoked) during the awaited auth.ok write: no timers, no lifted cap
        s.phase = 'closed';
        if (out.credential === 'gui') out.abort();
        throw new RpcRefusal('ENGINE', 'gone', 'the connection closed during authentication');
      }
      clearTimers(s.connId);
      ctx.authenticated(); // lift the 16 KiB pre-auth frame cap
      if (out.credential === 'read-token') {
        armTokenTimers(s, ctx);
        return { principal: out.principal, connId: s.connId, credential: 'read-token', expiresAt: out.expiresAt };
      }
      if (out.credential === 'gui') {
        out.commit();
        return { guiToken: out.guiToken, principal: out.principal, connId: s.connId };
      }
      return { principal: out.principal, connId: s.connId };
    }

    const known = VERB_NAMES.includes(m) || RELAY_NAMES.includes(m);
    if (!known) throw new RpcRefusal('UNKNOWN_VERB', 'unknown-verb', `unknown verb ${JSON.stringify(m.slice(0, 64))}`);
    if (s.phase !== 'authenticated') {
      // G-SOCK-01: unauthenticated ⇒ AUTH + close (a client that calls before auth is not one we keep talking to)
      if (s.phase !== 'closed') {
        s.phase = 'closed';
        o.onPreAuthClose?.('unauthenticated-call');
      }
      throw new RpcRefusal('AUTH', 'unauthenticated', `${m} needs hello + auth on this connection`, { required: ['hello', 'auth'] }, { closeAfter: true });
    }
    if (s.credential === 'read-token') {
      const dead = liveTokenCheck(s);
      if (dead) throw tokenDead(s, ctx, dead, false);
    }

    const cls = matrixClassOf(s);
    const access: Access = accessOf(m, cls);
    if (access === false) throw new RpcRefusal('FORBIDDEN', 'matrix', `${m} is not callable by a ${cls} principal (§5)`, { verb: m, principalClass: cls });
    if (READ_METHODS.includes(m)) {
      const reads = o.reads;
      if (!reads) throw new RpcRefusal('ENGINE', 'not-implemented', `${m} is not implemented yet (lands with ${VERB_MILESTONES[m]})`, { verb: m, milestone: VERB_MILESTONES[m] });
      try {
        if (m === 'log.read') {
          const grant = readerFor(s); // explicit per-class policy: never the generic 'full' view
          const params = parseLogReadParams(frame.params);
          if (params.follow && !Object.hasOwn(frame, 'id')) throw new RpcRefusal('BAD_REQUEST', 'follow-needs-id', 'a subscription is opened by a request with an id (its reply names the subscription)');
          return params.follow ? reads.hub.subscribe(ctx, grant, params) : readOnePage(reads.log, grant, params);
        }
        const r = resolveRef(frame.params, reads.log, () => readerFor(s).reader);
        if (!r.ok) throw new RpcRefusal(r.code, r.reason, r.message, r.data);
        return r.result;
      } catch (err) {
        throw asRpcRefusal(err);
      }
    }
    // M1.6 (T-2026-10-17-017): approve's qualified human value and permit.reserve, handled explicitly.
    if (m === 'approve') {
      if (cls === 'voice') throw asRpcRefusal(voiceApproveRefusal()); // every form, before any port (G-ABI-02 voice row)
      if (cls === 'human' && o.approvals) {
        try {
          return await o.approvals.approve({ connId: s.connId, principal: s.principal!, principalClass: cls, surface: s.client?.surface ?? null, credential: s.credential ?? 'device', isLive: () => !ctx.closed && conns.get(s.connId) === s }, frame.params);
        } catch (err) {
          throw asRpcRefusal(err);
        }
      }
    }
    if (m === 'permit.reserve' && cls === 'session') {
      throw new RpcRefusal('ENGINE', 'not-implemented', 'permit.reserve for a session principal is scoped (own scope); session principals land with M1.7', { verb: m, access: String(access), milestone: 'M1.7' });
    }
    if (m === 'permit.reserve' && (cls === 'human' || cls === 'agent') && o.approvals) {
      try {
        return await o.approvals.reserve({ connId: s.connId, principal: s.principal!, principalClass: cls, surface: s.client?.surface ?? null, credential: s.credential ?? 'device' }, frame.params);
      } catch (err) {
        throw asRpcRefusal(err);
      }
    }
    // M1.7 slice 1: session.open/send/stop for a human principal (attended, human-started sessions only)
    if (SESSION_METHODS.includes(m) && cls === 'human' && o.sessions) {
      const sctx = { principal: s.principal!, principalClass: cls };
      try {
        return await (m === 'session.open' ? o.sessions.open(sctx, frame.params) : m === 'session.send' ? o.sessions.send(sctx, frame.params) : o.sessions.stop(sctx, frame.params));
      } catch (err) {
        throw asRpcRefusal(err);
      }
    }
    if (access !== 'yes' && SERVED_METHODS.includes(m)) {
      const milestone = SCOPED_VIEW_MILESTONES[cls] ?? VERB_MILESTONES[m];
      throw new RpcRefusal('ENGINE', 'not-implemented', `${m} for a ${cls} principal is scoped (${String(access)}); the scoped view lands with ${milestone}`, {
        verb: m,
        access: String(access),
        milestone,
      });
    }

    if (m === 'log.append') {
      try {
        refuseAppend(cls as AppendClass, s.principal, frame.params);
      } catch (err) {
        throw asRpcRefusal(err);
      }
    }
    if (m === 'status') return status(s);
    throw new RpcRefusal('ENGINE', 'not-implemented', `${m} is not implemented yet (lands with ${VERB_MILESTONES[m]})`, { verb: m, milestone: VERB_MILESTONES[m] });
  };

  return {
    handle,
    onConnect: (ctx) => {
      if (preAuthCount() >= maxPreAuth) {
        o.onPreAuthClose?.('pre-auth-cap');
        ctx.close();
        return;
      }
      const s = stateOf(ctx.connId);
      const expire = (why: PreAuthCloseReason, test: () => boolean) => () => {
        if (conns.get(ctx.connId) === s && test()) {
          o.onPreAuthClose?.(why);
          ctx.close();
        }
      };
      timers.set(ctx.connId, [
        setTimeout(expire('hello-timeout', () => s.phase === 'new'), helloMs).unref(),
        setTimeout(expire('pre-auth-timeout', () => s.phase !== 'authenticated'), preAuthMs).unref(),
      ]);
    },
    onDisconnect: (ctx) => {
      o.reads?.hub.disconnect(ctx.connId);
      o.approvals?.connectionClosed(ctx.connId);
      clearTimers(ctx.connId);
      conns.delete(ctx.connId);
    },
    clients: () => [...conns.values()].filter((c) => c.phase === 'authenticated'),
    timerCount: () => timers.size,
  };
}

function isClient(p: unknown): p is { client: { name?: unknown; version?: unknown; surface?: unknown } } {
  return p !== null && typeof p === 'object' && 'client' in p && (p as { client: unknown }).client !== null && typeof (p as { client: unknown }).client === 'object';
}

function clip(v: unknown): string | null {
  return typeof v === 'string' ? v.slice(0, 128) : null;
}
