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
 * Access qualifiers: only the plain `'yes'` of the matrix is served; any
 * qualified value (`'own view'`, `'redacted'`, `'own scope'`, …) needs a scoped
 * view that does not exist yet and is refused ENGINE{not-implemented} naming
 * its milestone — never the full view.
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
 * Pre-auth limits (Aegis round 2): a connection with no hello after
 * `helloTimeoutMs` (10 s) or not authenticated after `preAuthTimeoutMs` (the
 * 30 s nonce TTL) is closed; at most `maxPreAuth` (64) unauthenticated
 * connections exist at once — the next one is closed on connect. Closures are
 * counted for the coalesced diagnostic row (daemon.ts), not logged one by one.
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
import type { ConnAuthState, SocketAuthenticator } from './auth.js';

/** Where each not-yet-served method lands (spec §19). */
export const VERB_MILESTONES: Readonly<Record<string, string>> = Object.freeze({
  status: 'M1.4',
  'session.open': 'M1.7',
  'session.send': 'M1.7',
  'session.stop': 'M1.7',
  'log.append': 'M1.4',
  'log.read': 'M1.4',
  'permit.reserve': 'M1.6',
  approve: 'M1.6',
  'contract.register': 'M2.1',
  'contract.claim': 'M2.2',
  'oracle.run': 'M2.3',
  'ref.resolve': 'M1.4',
  'mod.view': 'M1.11',
  'mod.command': 'M1.11',
});

export const SERVED_METHODS: readonly string[] = Object.freeze(['status']);

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
}

export type SocketLogKind = 'socket.hello' | 'socket.auth.ok' | 'socket.auth.fail' | 'socket.auth.replay';

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
  onPreAuthClose?: (why: 'hello-timeout' | 'pre-auth-timeout' | 'pre-auth-cap') => void;
  status: KernelStatusSource;
  /** Append a socket.* row to the kernel log; must reject if the row was not written. */
  log: (kind: SocketLogKind, payload: Record<string, unknown>, ids: { connId: string; deviceId?: string }) => Promise<void>;
}

export interface KernelDispatcher {
  handle: RpcHandler;
  onConnect(ctx: ConnectionContext): void;
  onDisconnect(ctx: ConnectionContext): void;
  /** Authenticated connections (status `clients`). */
  clients(): ConnAuthState[];
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
    const cls = matrixClass(s.principalKind!);
    const facts = new Set<string>(['noSession', 'noPermit', cls]);
    if (cls === 'agent' || cls === 'session') facts.add('agent|session');
    if (cls === 'voice') facts.add('!armed');
    const key = o.status.kernelKey();
    const available = (m: string): boolean => SERVED_METHODS.includes(m);
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
      nextLegalVerbs: nextLegalVerbs(facts).map((v) => ({ verb: v, available: available(v.split(' ')[0]!) })),
      verbs: VERBS.map((v) => ({ verb: v.verb, access: v.access[cls], available: available(v.verb), milestone: VERB_MILESTONES[v.verb] })),
      relays: CLIENT_RELAYS.map((r) => ({ relay: r.relay, available: false, milestone: VERB_MILESTONES[r.relay] })),
      daemon: o.status.daemon(),
      log: o.status.log(),
      sessions: { n: 0 },
      cards: { n: 0, pendingForYou: 0 },
      kernelKeyId: key.keyId,
      kernelKeyCustody: key.custody,
      kernelKeySource: key.source,
      root: o.status.root(),
      web: { listening: false },
      clients: [...conns.values()]
        .filter((c) => c.phase === 'authenticated')
        .map((c) => ({ connId: c.connId, principal: c.principal, surface: c.client?.surface ?? null, client: { name: c.client?.name, version: c.client?.version }, conformance: c.client?.conformance ?? null })),
    };
  };

  const handle: RpcHandler = async (frame: RpcRequestFrame, ctx: ConnectionContext) => {
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
      const out = o.authenticator.authenticate(s, frame.params);
      if (!out.ok) {
        await o
          .log(out.replay ? 'socket.auth.replay' : 'socket.auth.fail', { reason: out.reason, ...(out.principalClaimed ? { principalClaimed: out.principalClaimed } : {}) }, {
            connId: s.connId,
            ...(out.deviceId ? { deviceId: out.deviceId } : {}),
          })
          .catch(() => undefined); // the refusal and the close happen regardless
        throw RpcRefusal.from(out, { closeAfter: true });
      }
      try {
        await o.log('socket.auth.ok', { principal: out.principal, principalKind: out.principalKind, keyId: out.keyId, surface: s.client?.surface ?? null }, { connId: s.connId, deviceId: out.deviceId });
      } catch {
        s.phase = 'closed'; // never authenticated without the row
        throw new RpcRefusal('ENGINE', 'log-write-failed', 'the kernel log refused the auth row; not authenticated', undefined, { closeAfter: true });
      }
      clearTimers(s.connId);
      ctx.authenticated(); // lift the 16 KiB pre-auth frame cap
      return { principal: out.principal, connId: s.connId };
    }

    const known = VERB_NAMES.includes(m) || RELAY_NAMES.includes(m);
    if (!known) throw new RpcRefusal('UNKNOWN_VERB', 'unknown-verb', `unknown verb ${JSON.stringify(m.slice(0, 64))}`);
    if (s.phase !== 'authenticated') throw new RpcRefusal('AUTH', 'unauthenticated', `${m} needs hello + auth on this connection`, { required: ['hello', 'auth'] });

    const cls = matrixClass(s.principalKind!);
    const verb = VERBS.find((v) => v.verb === m);
    const access: Access = verb ? verb.access[cls] : cls === 'peer' ? false : 'caller principal';
    if (access === false) throw new RpcRefusal('FORBIDDEN', 'matrix', `${m} is not callable by a ${cls} principal (§5)`, { verb: m, principalClass: cls });
    // TODO(M1.6, #approval-broker): `approve`'s human access value is the qualified string
    // 'presence per class; root key for use-api-token, install; …' — when approve is served it
    // must be handled EXPLICITLY here (presence class per §3.4), not refused by this generic rule.
    if (access !== 'yes' && SERVED_METHODS.includes(m)) {
      const milestone = SCOPED_VIEW_MILESTONES[cls] ?? VERB_MILESTONES[m];
      throw new RpcRefusal('ENGINE', 'not-implemented', `${m} for a ${cls} principal is scoped (${String(access)}); the scoped view lands with ${milestone}`, {
        verb: m,
        access: String(access),
        milestone,
      });
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
      const expire = (why: 'hello-timeout' | 'pre-auth-timeout', test: () => boolean) => () => {
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
      clearTimers(ctx.connId);
      conns.delete(ctx.connId);
    },
    clients: () => [...conns.values()].filter((c) => c.phase === 'authenticated'),
  };
}

function isClient(p: unknown): p is { client: { name?: unknown; version?: unknown; surface?: unknown } } {
  return p !== null && typeof p === 'object' && 'client' in p && (p as { client: unknown }).client !== null && typeof (p as { client: unknown }).client === 'object';
}

function clip(v: unknown): string | null {
  return typeof v === 'string' ? v.slice(0, 128) : null;
}
